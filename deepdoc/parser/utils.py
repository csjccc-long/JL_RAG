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

from io import BytesIO

from pypdf import PdfReader as pdf2_read

from rag.nlp import find_codec
"""
1. get_text()：读取文本内容
这个函数的职责是把文件或二进制数据转成字符串。

它支持两种输入：

binary is not None
直接按编码解析 bytes
使用 find_codec(binary) 判断编码
否则
以文本文件方式逐行读取
也就是说，它是一个“文本读取工具”，用于把文档内容转成统一的字符串格式，供后续解析器处理。

2. extract_pdf_outlines()：提取 PDF 目录结构
这个函数用 pypdf.PdfReader 打开 PDF，然后遍历 pdf.outline。

它会递归解析 PDF 的目录树，提取：

标题文本
层级深度
对应页码
"""

def get_text(fnm: str, binary=None) -> str:
    txt = ""
    if binary is not None:
        encoding = find_codec(binary)
        txt = binary.decode(encoding, errors="ignore")
    else:
        with open(fnm, "r") as f:
            while True:
                line = f.readline()
                if not line:
                    break
                txt += line
    return txt


def extract_pdf_outlines(source):
    try:
        with pdf2_read(source if isinstance(source, str) else BytesIO(source)) as pdf:
            outlines = []

            def dfs(nodes, depth):
                for node in nodes:
                    if isinstance(node, list):
                        dfs(node, depth + 1)
                    else:
                        outlines.append((node["/Title"], depth, pdf.get_destination_page_number(node) + 1))

            dfs(pdf.outline, 0)
            return outlines
    except Exception:
        return []
