import asyncio

from memory.backends.mem0 import Mem0MemoryBackend


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, payload=None, error=None):
        self.payload = payload if payload is not None else {}
        self.error = error
        self.calls = []

    async def post(self, path, json=None):
        self.calls.append((path, json))
        if self.error:
            raise self.error
        if "search" in path:
            return FakeResponse({"results": self.payload.get("results", [])})
        return FakeResponse({"message": "ok"})

    async def aclose(self):
        return None


def run(coro):
    return asyncio.run(coro)


def test_recall_posts_search_and_parses_results():
    client = FakeClient(
        {
            "results": [
                {"id": "m2", "memory": "偏好简洁回答", "score": 0.4, "metadata": {"k": "v"}},
                {"id": "m1", "memory": "在做一个 RAG 项目", "score": 0.9},
                {"id": "m3", "memory": "", "score": 0.99},
            ]
        }
    )
    backend = Mem0MemoryBackend("http://mem0:8888", http_client=client)
    records = run(backend.recall(namespace="user-1", query="项目", limit=3))
    assert [record.text for record in records] == ["在做一个 RAG 项目", "偏好简洁回答"]
    path, body = client.calls[0]
    assert path == "/memories/search"
    assert body["user_id"] == "user-1"
    assert body["query"] == "项目"


def test_remember_posts_messages_with_user_id():
    client = FakeClient()
    backend = Mem0MemoryBackend("http://mem0:8888", api_key="secret", http_client=client)
    run(backend.remember(namespace="user-9", user_text="我喜欢晚上工作", assistant_text="记下了", session_id="conv-1"))
    path, body = client.calls[0]
    assert path == "/memories"
    assert body["user_id"] == "user-9"
    assert body["run_id"] == "conv-1"
    assert body["messages"][0] == {"role": "user", "content": "我喜欢晚上工作"}
    assert body["messages"][1]["role"] == "assistant"
    assert backend._headers()["X-API-Key"] == "secret"


def test_recall_degrades_when_mem0_is_unreachable():
    backend = Mem0MemoryBackend("http://mem0:8888", http_client=FakeClient(error=RuntimeError("connection refused")))
    assert run(backend.recall(namespace="u", query="q", limit=5)) == []


def test_missing_base_url_disables_backend():
    backend = Mem0MemoryBackend("")
    assert run(backend.recall(namespace="u", query="q", limit=5)) == []
    run(backend.remember(namespace="u", user_text="hello there", assistant_text="hi"))
