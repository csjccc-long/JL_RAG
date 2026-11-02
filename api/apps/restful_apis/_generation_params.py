#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
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

from copy import deepcopy
# 关于 LLM 生成参数的默认值和启用标志的说明，请参阅
GENERATION_CONFIG_KEYS = ("temperature", "top_p", "frequency_penalty", "presence_penalty", "max_tokens")

#存储在 #search_config.llm_setting 中的四个 LLM 生成参数的默认值。
#当对应的“_enabled”标志为“False”（或该键不存在）时，将使用默认值，而不是用户在“llm_setting”中可能存储的任何值。
LLM_SETTING_DEFAULTS = {
    "temperature": 0.1, # 作用： 控制生成文本的随机性。较低的值会导致更确定性的输出，而较高的值会增加多样性和创造力。
    "top_p": 0.3, # 作用： 控制生成文本的多样性。较低的值会限制模型选择的词汇范围，而较高的值会增加多样性和创造力。
    "frequency_penalty": 0.7, # 作用： 控制生成文本中重复词汇的频率。较高的值会减少重复词汇的出现，而较低的值可能会增加重复性。
    "presence_penalty": 0.4, # 作用： 控制生成文本中新词汇的引入。较高的值会鼓励模型引入新的词汇，而较低的值可能会限制新词汇的使用。
}


def resolve_llm_setting(llm_setting):
    """根据各自的启用标志解析 llm_setting 中的值。

    对于这四个生成参数，字典中可能包含一个 {key}_enabled 布尔值。当该标志为 True 且 llm_setting 中存在对应值时，保留用户配置的值；
    否则使用 :data:LLM_SETTING_DEFAULTS 中的默认值进行替换。

    名称以 _enabled 结尾的键将从结果中剔除，以确保它们不会被传递到下游的 LLM 调用中。
    """
    if not llm_setting:
        return dict(LLM_SETTING_DEFAULTS)

    resolved = {}
    for key, default_val in LLM_SETTING_DEFAULTS.items():
        enabled_key = f"{key}_enabled"
        if llm_setting.get(enabled_key, True) and key in llm_setting:
            resolved[key] = llm_setting[key]
        else:
            resolved[key] = default_val

    # 保留所有额外的键，这些键既不是生成参数，也不是启用标志（例如 llm_id、model_type）。
    for key, val in llm_setting.items():
        if key not in resolved and not key.endswith("_enabled"):
            resolved[key] = val

    return resolved


def extract_generation_config(req):
    return {key: req[key] for key in GENERATION_CONFIG_KEYS if key in req and req[key] is not None}


def pop_generation_config(req):
    generation_config = extract_generation_config(req)
    for key in GENERATION_CONFIG_KEYS:
        req.pop(key, None)
    return generation_config

# 合并 LLM 生成参数
def merge_generation_config(dialog, generation_config):
    if not generation_config:
        return
    llm_setting = deepcopy(getattr(dialog, "llm_setting", None) or {})
    llm_setting.update(generation_config)
    dialog.llm_setting = llm_setting
