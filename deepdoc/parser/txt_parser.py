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
import re

from deepdoc.parser.utils import get_text
from rag.nlp import MergeStrategy, merge_paragraphs
from rag.nlp.delim import (
    compile_delimiter_pattern,
    normalize_text_newlines,
    parse_delimiter_field,
)
"""
一个“纯文本解析器”，它负责把文本文件切分成适合后续检索/向量化的 chunk。

它属于 deepdoc 里的 parser 层，作用是：

读取文本内容
按指定分隔符切段
合并相邻段落
生成可检索的 chunk 列表
它具体做了什么
1. 读取文本
__call__() 中会先调用：

get_text(fnm, binary)
把文本内容读成字符串。
这说明它是基于文本文件输入的解析器。

2. 按分隔符拆分
parser_txt() 会做：

normalize_text_newlines(txt)
parse_delimiter_field(delimiter)
compile_delimiter_pattern(parsed_dels)
re.split(...)
也就是说，它会按设定的分隔符（例如 \n!?;。；！？）把文本拆成多个段落/小节。

3. 去掉无用分隔符
在拆分后，它会过滤掉：

空段
仅分隔符的片段
并在 keep_delimiters 为真时保留分隔符信息，保证语义连续性。

4. 合并成 chunk
关键一步：


这表示它不只是简单拆分，而是根据 token 数量把段落合并成 chunk，保证每块内容在合理长度内。
"""

class RAGFlowTxtParser:
    def __call__(self, fnm, binary=None, chunk_token_num=128, delimiter="\n!?;。；！？", keep_delimiters=False):
        txt = get_text(fnm, binary)
        return self.parser_txt(txt, chunk_token_num, delimiter, keep_delimiters)

    @classmethod
    def parser_txt(cls, txt, chunk_token_num=128, delimiter="\n!?;。；！？", keep_delimiters=False):
        if not isinstance(txt, str):
            raise TypeError("txt type should be str!")
        txt = normalize_text_newlines(txt)
        parsed_dels = parse_delimiter_field(delimiter)
        dels = compile_delimiter_pattern(parsed_dels)
        logging.debug(
            "RAGFlowTxtParser.parser_txt: delimiter_count=%d, splitting=%s",
            len(parsed_dels),
            bool(dels),
        )
        secs = re.split(r"(%s)" % dels, txt) if dels else [txt]
        paragraphs = []
        for index, sec in enumerate(secs):
            if dels and re.match(f"^{dels}$", sec):
                continue
            if not sec:
                continue
            if keep_delimiters and index + 1 < len(secs) and re.match(f"^{dels}$", secs[index + 1]):
                sec += secs[index + 1]
            paragraphs.append(sec)

        # Group delimiter-split paragraphs with the OVER_CAP merge strategy: no
        # atom-split, delimiter text never enters a chunk. A paragraph larger
        # than chunk_token_num stands alone; the model layer truncates it.
        groups = merge_paragraphs(paragraphs, chunk_token_num, MergeStrategy.OVER_CAP)
        cks = ["\n".join(g) for g in groups]
        logging.debug("parser_txt: %d sections -> %d chunks (chunk_token_num=%d)", len(secs), len(cks), chunk_token_num)
        return [[c, ""] for c in cks]
