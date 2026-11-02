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
from agent.component.fillup import UserFillUpParam, UserFillUp
"""
定义开始节点参数

BeginParam 继承自用户填充参数类，增加了两个关键字段：
mode：启动模式，支持 conversational、task、Webhook
prologue：欢迎语
这里的 check() 会校验这些值是否合法，确保配置符合允许范围。
负责合并真实用户输入

Begin._merge_runtime_inputs()
它会从 canvas 的全局变量里拿取当前请求的输入，例如 sys.query
如果用户给的是字典或单个值，它会把它整理成组件输入字段对应的结构
把输入写入输出和输入缓存

_invoke() 中会遍历合并后的输入
对每个字段执行 set_output() 和 set_input_value()
也就是把“用户输入”转成后续节点能读取的变量

"""

class BeginParam(UserFillUpParam):
    """
    Define the Begin component parameters.
    """

    def __init__(self):
        super().__init__()
        self.mode = "conversational"
        self.prologue = "Hi! I'm your smart assistant. What can I do for you?"

    def check(self):
        self.check_valid_value(self.mode, "The 'mode' should be either `conversational` or `task`", ["conversational", "task", "Webhook"])

    def get_input_form(self) -> dict[str, dict]:
        return getattr(self, "inputs")


class Begin(UserFillUp):
    component_name = "Begin"

    def _merge_runtime_inputs(self, runtime_inputs):
        if runtime_inputs:
            return runtime_inputs

        fields = self.get_input_elements()
        query = self._canvas.globals.get("sys.query")
        if not fields or query is None or query == "":
            return {}

        if isinstance(query, dict):
            return {key: value if isinstance(value, dict) else {"value": value} for key, value in query.items() if key in fields}

        if len(fields) == 1:
            return {next(iter(fields)): {"value": query}}

        return {}

    def _invoke(self, **kwargs):
        if self.check_if_canceled("Begin processing"):
            return

        layout_recognize = self._param.layout_recognize or None
        merged_inputs = self._merge_runtime_inputs(kwargs.get("inputs", {}))
        for k, v in merged_inputs.items():
            if self.check_if_canceled("Begin processing"):
                return
            v = self._resolve_input_value(v, layout_recognize)
            self.set_output(k, v)
            self.set_input_value(k, v)

    def thoughts(self) -> str:
        return ""
