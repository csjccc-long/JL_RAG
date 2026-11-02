#
#  Copyright 2025 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
#

import logging
from io import BytesIO
from pptx import Presentation

"""
1. 读取 PPT 文件
它使用了：

from pptx import Presentation
也就是 Python 的 python-pptx 库来打开 PPT 文件。

支持两种输入：

文件路径
内存中的二进制数据 BytesIO
这意味着它既能处理磁盘上的 .pptx，也能处理上传后的内存对象。

2. 遍历每一页幻灯片
在 __call__() 里：

ppt.slides 遍历每一页
按 from_page 和 to_page 做分页过滤
对每页 slide 继续处理
所以它是“按页抽取内容”的解析器。

3. 提取文本元素
__extract(shape) 会递归处理每个 shape：

如果 shape 含有 text_frame，提取段落文本
如果是列表项，识别项目符号并保留层级
如果是表格，读取表格内容
如果是分组对象（group shape），继续递归展开
忽略不含文字的形状
这保证了 PPT 中常见的：

标题
正文
列表
表格
组合元素
都可以被提取成文本。

4. 处理列表和层级
__get_bulleted_text(paragraph) 会检测段落是否有项目符号，例如：

a:buChar
a:buAutoNum
a:buBlip
如果有，就在前面加层级标识，例如：

"  .text" 这种形式
这样后续文本保留了列表结构，而不是直接丢失。

5. 按位置排序
__sort_shapes(shapes) 会根据 top 和 left 排序页面中的元素，保证文本按页面布局顺序输出，而不是随机顺序。

这很重要，因为 PPT 中文本通常是有布局顺序的。
"""
class RAGFlowPptParser:
    def __init__(self):
        super().__init__()
        self._shape_cache = {}

    def __sort_shapes(self, shapes):
        cache_key = id(shapes)
        if cache_key not in self._shape_cache:
            self._shape_cache[cache_key] = sorted(shapes, key=lambda x: ((x.top if x.top is not None else 0) // 10, x.left if x.left is not None else 0))
        return self._shape_cache[cache_key]

    def __get_bulleted_text(self, paragraph):
        is_bulleted = bool(paragraph._p.xpath("./a:pPr/a:buChar")) or bool(paragraph._p.xpath("./a:pPr/a:buAutoNum")) or bool(paragraph._p.xpath("./a:pPr/a:buBlip"))
        if is_bulleted:
            return f"{'  ' * paragraph.level}.{paragraph.text}"
        else:
            return paragraph.text

    def __extract(self, shape):
        try:
            # First try to get text content
            if hasattr(shape, "has_text_frame") and shape.has_text_frame:
                text_frame = shape.text_frame
                texts = []
                for paragraph in text_frame.paragraphs:
                    if paragraph.text.strip():
                        texts.append(self.__get_bulleted_text(paragraph))
                return "\n".join(texts)

            # Safely get shape_type
            try:
                shape_type = shape.shape_type
            except NotImplementedError:
                # If shape_type is not available, try to get text content
                if hasattr(shape, "text"):
                    return shape.text.strip()
                return ""

            # Handle table
            if shape_type == 19:
                tb = shape.table
                rows = []
                for i in range(1, len(tb.rows)):
                    rows.append("; ".join([tb.cell(0, j).text + ": " + tb.cell(i, j).text for j in range(len(tb.columns)) if tb.cell(i, j)]))
                return "\n".join(rows)

            # Handle group shape
            if shape_type == 6:
                texts = []
                for p in self.__sort_shapes(shape.shapes):
                    t = self.__extract(p)
                    if t:
                        texts.append(t)
                return "\n".join(texts)

            return ""

        except Exception as e:
            logging.error(f"Error processing shape: {str(e)}")
            return ""

    def __call__(self, fnm, from_page, to_page, callback=None):
        ppt = Presentation(fnm) if isinstance(fnm, str) else Presentation(BytesIO(fnm))
        txts = []
        self.total_page = len(ppt.slides)
        for i, slide in enumerate(ppt.slides):
            if i < from_page:
                continue
            if i >= to_page:
                break
            texts = []
            for shape in self.__sort_shapes(slide.shapes):
                txt = self.__extract(shape)
                if txt:
                    texts.append(txt)
            txts.append("\n".join(texts))

        return txts
