#
#  Copyright 2024 The InfiniFlow Authors. All Rights Reserved.
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
import asyncio
import logging
import os
import re
from abc import ABC

from common.constants import LLMType
from api.db.services.llm_service import LLMBundle
from api.db.joint_services.tenant_model_service import resolve_model_config
from agent.component.llm import LLMParam, LLM
from common.connection_utils import timeout
from rag.llm.chat_model import ERROR_PREFIX

"""
1. 定义分类参数
CategorizeParam 里有几个关键字段：

category_description：分类规则和示例
query：要分类的文本来源
message_history_window_size：看最近多少条历史消息参与分类
它还在 update_prompt() 里动态拼装一个系统提示词，用来告诉模型：

这是一个分类任务
需要从多个类别里选一个
只返回类别名，不要解释
这相当于把“分类规则”固化进 prompt。

2. 生成分类提示词
在 update_prompt() 里，它会遍历 category_description：

把每个类别的例子整理成 USER: "..." → Category
把每个类别的说明也写进 prompt
最终生成一个带示例和规则的分类系统 prompt
这样模型就知道“什么样的输入属于哪个类别”。

3. 读取输入并构造分类上下文
get_input_elements() 中，它会读取 query 变量，通常默认是 sys.query，也就是当前用户问题。

在 _invoke_async() 中，它会：

取最近几条历史消息
把最后一条消息替换成当前 query
组装一个格式化后的 user_prompt
调用模型做分类
4. 调用 LLM 做分类
它不是自己写规则判断，而是调用 LLMBundle.async_chat()，把 prompt 和上下文发给 LLM：

让模型判断当前问题属于哪个类别
返回内容通常是某个类别名
如果模型返回异常前缀 ERROR_PREFIX，它会抛异常。

5. 解析模型返回并决定下一步分支
分类结果不是直接输出文本，而是做了进一步处理：

统计每个类别在答案中出现的次数
取出现次数最多的类别作为 max_category
然后从 category_description[max_category]["to"] 取出对应下一跳的组件 ID
写入输出字段：
category_name
_next
也就是说，这个节点不仅“归类”，还负责“告诉流程接下来该去哪个节点”。


"""
class CategorizeParam(LLMParam):
    """
    Define the categorize component parameters.
    """

    def __init__(self):
        super().__init__()
        self.category_description = {}
        self.query = "sys.query"
        self.message_history_window_size = 1
        self.update_prompt()

    def check(self):
        if not isinstance(self.message_history_window_size, int) or self.message_history_window_size < 0:
            raise ValueError("[Categorize] Message window size cannot be negative")
        self.check_empty(self.category_description, "[Categorize] Category examples")
        for k, v in self.category_description.items():
            if not k:
                raise ValueError("[Categorize] Category name can not be empty!")
            if not v.get("to"):
                raise ValueError(f"[Categorize] 'To' of category {k} can not be empty!")

    def get_input_form(self) -> dict[str, dict]:
        return {"query": {"type": "line", "name": "Query"}}

    def update_prompt(self):
        cate_lines = []
        for c, desc in self.category_description.items():
            for line in desc.get("examples", []):
                if not line:
                    continue
                cate_lines.append('USER: "' + re.sub(r"\n", "    ", line, flags=re.DOTALL) + '" → ' + c)

        descriptions = []
        for c, desc in self.category_description.items():
            if desc.get("description"):
                descriptions.append("\n------\nCategory: {}\nDescription: {}".format(c, desc["description"]))

        self.sys_prompt = """
You are an advanced classification system that categorizes user questions into specific types. Analyze the input question and classify it into ONE of the following categories:
{}

Here's description of each category:
 - {}

---- Instructions ----
 - Consider both explicit mentions and implied context
 - Prioritize the most specific applicable category
 - Return only the category name without explanations
 - Use "Other" only when no other category fits

 """.format("\n - ".join(list(self.category_description.keys())), "\n".join(descriptions))

        if cate_lines:
            self.sys_prompt += """
---- Examples ----
{}
""".format("\n".join(cate_lines))


class Categorize(LLM, ABC):
    component_name = "Categorize"

    def get_input_elements(self) -> dict[str, dict]:
        query_key = self._param.query or "sys.query"
        elements = self.get_input_elements_from_text(f"{{{query_key}}}")
        if not elements:
            logging.warning(f"[Categorize] input element not detected for query key: {query_key}")
        return elements

    @timeout(int(os.environ.get("COMPONENT_EXEC_TIMEOUT", 10 * 60)))
    async def _invoke_async(self, **kwargs):
        if self.check_if_canceled("Categorize processing"):
            return

        msg = self._canvas.get_history(self._param.message_history_window_size)
        if not msg:
            msg = [{"role": "user", "content": ""}]
        query_key = self._param.query or "sys.query"
        if query_key in kwargs:
            query_value = kwargs[query_key]
        else:
            query_value = self._canvas.get_variable_value(query_key)
        if query_value is None:
            query_value = ""
        msg[-1]["content"] = query_value
        self.set_input_value(query_key, msg[-1]["content"])
        self._param.update_prompt()
        chat_model_config = resolve_model_config(self._canvas.get_tenant_id(), LLMType.CHAT, self._param.llm_id)
        chat_mdl = LLMBundle(self._canvas.get_tenant_id(), chat_model_config)

        user_prompt = """
---- Real Data ----
{} →
""".format(" | ".join(['{}: "{}"'.format(c["role"].upper(), re.sub(r"\n", "", c["content"], flags=re.DOTALL)) for c in msg]))

        if self.check_if_canceled("Categorize processing"):
            return

        ans = await chat_mdl.async_chat(self._param.sys_prompt, [{"role": "user", "content": user_prompt}], self._param.gen_conf())
        logging.info(f"input: {user_prompt}, answer: {str(ans)}")
        if ERROR_PREFIX in ans:
            raise Exception(ans)

        if self.check_if_canceled("Categorize processing"):
            return

        # Count the number of times each category appears in the answer.
        category_counts = {}
        for c in self._param.category_description.keys():
            count = ans.lower().count(c.lower())
            category_counts[c] = count

        cpn_ids = list(self._param.category_description.items())[-1][1]["to"]
        max_category = list(self._param.category_description.keys())[-1]
        if any(category_counts.values()):
            max_category = max(category_counts.items(), key=lambda x: x[1])[0]
            cpn_ids = self._param.category_description[max_category]["to"]

        self.set_output("category_name", max_category)
        self.set_output("_next", cpn_ids)

    @timeout(int(os.environ.get("COMPONENT_EXEC_TIMEOUT", 10 * 60)))
    def _invoke(self, **kwargs):
        return asyncio.run(self._invoke_async(**kwargs))

    def thoughts(self) -> str:
        return "Which should it falls into {}? ...".format(",".join([f"`{c}`" for c, _ in self._param.category_description.items()]))
