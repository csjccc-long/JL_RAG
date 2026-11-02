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
from abc import ABC
from agent.component.base import ComponentBase, ComponentParamBase

"""
class VariableModel(BaseModel):
    data_type: Annotated[Literal["string", "number", "Object", "Boolean", "Array<string>", "Array<number>", "Array<object>", "Array<boolean>"], Field(default="Array<string>")]
    input_mode: Annotated[Literal["constant", "variable"], Field(default="constant")]
    value: Annotated[Any, Field(default=None)]
    model_config = ConfigDict(extra="forbid")
"""
"""
它的职责是：当某个变量是一个列表时，告诉工作流“对每个元素重复执行一组子节点”，也就是实现批量遍历处理。

它属于工作流控制型组件，用于循环执行。

它具体做了什么
1. 定义循环参数
IterationParam 里有两个关键字段：

items_ref：要迭代的列表变量引用
variable：循环变量配置
它的 get_input_form() 也说明这是一个“items 输入”，用于接收列表数据。

2. 找到循环起点
get_start() 会遍历组件列表，寻找 IterationItem 子节点，并且它属于当前 Iteration 组件的父节点。
也就是它负责定位“循环体真正从哪一项开始执行”。

这说明它不是直接处理业务数据，而是负责组织循环结构。

3. 校验迭代数据
_invoke() 会读取 self._param.items_ref 对应的变量值，然后检查它是否是一个列表。

如果不是 list，就会写入错误输出：

_ERROR
比如：

传入的是字符串或对象，而不是数组，循环无法继续执行
4. 生成“需要处理多少项”的提示
thoughts() 会返回一条文本说明：

这个循环一共要处理多少个 item
它主要用于展示在 UI 或日志中"""

class IterationParam(ComponentParamBase):
    """
    Define the Iteration component parameters.
    """

    def __init__(self):
        super().__init__()
        self.items_ref = ""
        self.variable = {}

    def get_input_form(self) -> dict[str, dict]:
        return {"items": {"type": "json", "name": "Items"}}

    def check(self):
        return True


class Iteration(ComponentBase, ABC):
    component_name = "Iteration"

    def get_start(self):
        for cid in self._canvas.components.keys():
            if self._canvas.get_component(cid)["obj"].component_name.lower() != "iterationitem":
                continue
            if self._canvas.get_component(cid)["parent_id"] == self._id:
                return cid

    def _invoke(self, **kwargs):
        if self.check_if_canceled("Iteration processing"):
            return

        arr = self._canvas.get_variable_value(self._param.items_ref)
        if not isinstance(arr, list):
            self.set_output("_ERROR", self._param.items_ref + " must be an array, but its type is " + str(type(arr)))

    def thoughts(self) -> str:
        return "Need to process {} items.".format(len(self._canvas.get_variable_value(self._param.items_ref)))
