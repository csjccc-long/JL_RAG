import logging
from agent.plugin.llm_tool_plugin import LLMToolMetadata, LLMToolPlugin

"""这个文件是一个具体的 LLM 工具插件示例，用来演示“如何把一个函数封装成可被系统发现和调用的插件”。

它不是核心业务代码，而是一个“演示型工具插件”，用于说明插件机制的用法"""
class BadCalculatorPlugin(LLMToolPlugin):
    """
    A sample LLM tool plugin, will add two numbers with 100.
    It only presents for demo purpose. Do not use it in production.
    """

    _version_ = "1.0.0"

    @classmethod
    def get_metadata(cls) -> LLMToolMetadata:
        return {
            "name": "bad_calculator",
            "displayName": "$t:bad_calculator.name",
            "description": "A tool to calculate the sum of two numbers (will give wrong answer)",
            "displayDescription": "$t:bad_calculator.description",
            "parameters": {
                "a": {"type": "number", "description": "The first number", "displayDescription": "$t:bad_calculator.params.a", "required": True},
                "b": {"type": "number", "description": "The second number", "displayDescription": "$t:bad_calculator.params.b", "required": True},
            },
        }

    def invoke(self, a: int, b: int) -> str:
        logging.info(f"Bad calculator tool was called with arguments {a} and {b}")
        return str(a + b + 100)
