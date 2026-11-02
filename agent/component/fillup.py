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
import json
import re
from functools import partial

from agent.component.base import ComponentParamBase, ComponentBase
from api.db.services.file_service import FileService

"""
“用户填表/等待输入”组件。
它的作用是：在流程中接收用户输入、补全表单字段，并把这些值写回到组件输出和输入缓存里，供后续节点使用。

它本质上是工作流里的“输入收集节点”。

1. 定义参数
UserFillUpParam 里定义了几个核心参数：

enable_tips：是否展示提示语
tips：提示文案
layout_recognize：布局识别配置
这部分是说明“这个输入表单怎么展示和处理”。

2. 处理输入值的解析
_resolve_input_value() 会根据值的类型做处理：

如果是文件类型，调用 FileService.get_files(...)
如果是对象类型，尝试把 JSON 字符串转成 dict
其他情况直接返回原值
也就是说，它能把用户提交的不同表单值统一转换成工作流内部可消费的数据结构。

3. 合并运行时输入
_merge_runtime_inputs() 会把当前这次提交的输入合并进组件状态。
如果没有新输入，它会返回空字典，随后会清理旧值，避免循环再次复用上一次回答。

这是一个非常关键的逻辑：它避免了“等待输入节点在循环中误用历史输入”的问题。

4. 组装提示语
_invoke() 里，如果开启提示语模式，会先把 tips 里的模板变量替换成真实值。
例如 Hello {name} 会被替换成用户实际填写的内容。

这让交互更自然。

5. 存储用户输入
最后它会执行：

self.set_output(k, resolved)
self.set_input_value(k, resolved)
也就是把用户填入的内容写回组件的输出字段，后续工作流节点就可以读取它。
"""
class UserFillUpParam(ComponentParamBase):
    def __init__(self):
        super().__init__()
        self.enable_tips = True
        self.tips = "Please fill up the form"
        self.layout_recognize = ""

    def check(self) -> bool:
        return True


class UserFillUp(ComponentBase):
    component_name = "UserFillUp"

    def _merge_runtime_inputs(self, runtime_inputs):
        return runtime_inputs or {}

    def _resolve_input_value(self, value, layout_recognize):
        if isinstance(value, dict) and value.get("type", "").lower().find("file") >= 0:
            if value.get("optional") and value.get("value", None) is None:
                return None

            file_value = value["value"]
            files = file_value if isinstance(file_value, list) else [file_value]
            return FileService.get_files(files, layout_recognize=layout_recognize)

        if isinstance(value, dict):
            raw = value.get("value")
            if value.get("type") == "object" and isinstance(raw, str) and raw.strip():
                try:
                    return json.loads(raw)
                except Exception:
                    return raw
            return raw

        return value

    def _invoke(self, **kwargs):
        if self.check_if_canceled("UserFillUp processing"):
            return

        if self._param.enable_tips:
            content = self._param.tips
            for k, v in self.get_input_elements_from_text(self._param.tips).items():
                v = v["value"]
                ans = ""
                if isinstance(v, partial):
                    for t in v():
                        ans += t
                elif isinstance(v, list):
                    ans = ",".join([str(vv) for vv in v])
                elif not isinstance(v, str):
                    try:
                        ans = json.dumps(v, ensure_ascii=False)
                    except Exception:
                        pass
                else:
                    ans = v
                if not ans:
                    ans = ""
                content = re.sub(r"\{%s\}" % k, ans, content)

            self.set_output("tips", content)
        layout_recognize = self._param.layout_recognize or None
        merged_inputs = self._merge_runtime_inputs(kwargs.get("inputs", {}))
        if not merged_inputs:
            # No fresh user answer was supplied on this entry. Clear any values
            # retained from a previous response so the canvas wait-check treats
            # the form as unsatisfied and pauses for input again. Without this,
            # an Await Response node inside a Loop would only pause on the first
            # iteration and silently reuse the earlier answer afterwards.
            self._clear_form_values()
        for k, v in merged_inputs.items():
            if self.check_if_canceled("UserFillUp processing"):
                return
            resolved = self._resolve_input_value(v, layout_recognize)
            self.set_output(k, resolved)
            self.set_input_value(k, resolved)

    def _clear_form_values(self):
        for field in self.get_input_elements().values():
            if not isinstance(field, dict):
                continue
            field_type = str(field.get("type", "")).lower()
            # An optional file input is already treated as satisfied when empty
            # (see Canvas._is_input_field_satisfied), so clearing it would not
            # force a re-prompt and would only drop a previously uploaded file.
            # Leave it untouched to avoid unexpected data loss.
            if "file" in field_type and field.get("optional"):
                continue
            field["value"] = None

    def thoughts(self) -> str:
        return "Waiting for your input..."
