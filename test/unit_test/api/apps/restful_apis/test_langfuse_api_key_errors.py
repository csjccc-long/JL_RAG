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
"""Regression tests for /api/v1/langfuse/api-key.

`set_api_key` used to call `langfuse.auth_check()` outside a try block. When
Langfuse rejects the submitted keys the SDK raises `ApiError` carrying status
401, and `server_error_response()` rewrites any exception whose repr mentions
"401"/"unauthorized" into `RetCode.UNAUTHORIZED` (HTTP 401). The web client
treats a 401 as an expired session: it clears the token and redirects to
/login. A wrong Langfuse host therefore looked like being logged out, and the
settings were never saved.

These tests pin the endpoint to a *data* error so the dialog can show
Langfuse's own message.
"""

import asyncio
import importlib.util
import sys
from contextlib import nullcontext
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

PAYLOAD = {
    "secret_key": "sk-lf-test",
    "public_key": "pk-lf-test",
    "host": "https://langfuse.example.com",
}

ENTRY = {
    "public_key": "pk-lf-test",
    "secret_key": "sk-lf-test",
    "host": "https://langfuse.example.com",
}


class _PassthroughManager:
    def route(self, *_args, **_kwargs):
        return lambda func: func


class _LenientModule(ModuleType):
    """Placeholder for every attribute the module under test imports."""

    def __getattr__(self, _name):
        return lambda *_a, **_k: None


class _ApiError(Exception):
    """Stand-in for langfuse.api.core.api_error.ApiError."""

    def __init__(self, body=None):
        super().__init__(str(body))
        self.body = body
        self.status_code = 401


class _Client:
    """Fake Langfuse client; `auth_check` decides whether keys are accepted."""

    def __init__(self, auth_check):
        self._auth_check = auth_check

    def auth_check(self):
        return self._auth_check()


def _stub(monkeypatch, name, **attrs):
    mod = _LenientModule(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    monkeypatch.setitem(sys.modules, name, mod)
    return mod


def _load_api(monkeypatch, *, client, entry=None):
    calls = {"saved": [], "updated": [], "deleted": [], "server_errors": []}

    class _Service:
        @staticmethod
        def filter_by_tenant(tenant_id=None):
            return None

        @staticmethod
        def filter_by_tenant_with_info(tenant_id=None):
            return dict(entry) if entry else None

        @staticmethod
        def save(**kwargs):
            calls["saved"].append(kwargs)

        @staticmethod
        def update_by_tenant(**kwargs):
            calls["updated"].append(kwargs)

        @staticmethod
        def delete_model(model):
            calls["deleted"].append(model)

    async def _request_json():
        return dict(PAYLOAD)

    def _server_error_response(exc):
        calls["server_errors"].append(exc)
        return {"kind": "server_error", "code": 500, "error": str(exc)}

    _stub(
        monkeypatch,
        "api.apps",
        current_user=SimpleNamespace(id="tenant-1"),
        login_required=lambda func=None, **_kwargs: (lambda f: f) if func is None else func,
    )
    _stub(monkeypatch, "langfuse", Langfuse=lambda **_kwargs: client)
    _stub(monkeypatch, "langfuse.api", core=SimpleNamespace())
    _stub(monkeypatch, "langfuse.api.core", api_error=SimpleNamespace())
    _stub(monkeypatch, "langfuse.api.core.api_error", ApiError=_ApiError)
    _stub(monkeypatch, "api.db", db_models=SimpleNamespace())
    _stub(monkeypatch, "api.db.db_models", DB=SimpleNamespace(atomic=nullcontext))
    _stub(monkeypatch, "api.db.services.langfuse_service", TenantLangfuseService=_Service)
    _stub(
        monkeypatch,
        "api.utils.api_utils",
        get_error_data_result=lambda message="", code=102, data=False: {"kind": "data_error", "code": code, "message": message},
        get_json_result=lambda message="", code=0, data=None: {"kind": "json", "code": code, "message": message, "data": data},
        get_request_json=_request_json,
        server_error_response=_server_error_response,
        validate_request=lambda *_a, **_k: lambda func: func,
    )

    repo_root = Path(__file__).resolve().parents[5]
    module_path = repo_root / "api" / "apps" / "restful_apis" / "langfuse_api.py"
    spec = importlib.util.spec_from_file_location("test_langfuse_api_module", module_path)
    module = importlib.util.module_from_spec(spec)
    module.manager = _PassthroughManager()
    monkeypatch.setitem(sys.modules, "test_langfuse_api_module", module)
    spec.loader.exec_module(module)
    return module, calls


@pytest.mark.p1
class TestLangfuseApiKeySave:
    def test_rejected_credentials_return_data_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Langfuse answers 401 -> data error, never an app UNAUTHORIZED."""

        def _reject():
            raise _ApiError({"message": "Invalid credentials. Confirm that you've configured the correct host."})

        module, calls = _load_api(monkeypatch, client=_Client(_reject))
        result = asyncio.run(module.set_api_key())

        assert result["kind"] == "data_error", result
        assert result["code"] != 401, "a rejected Langfuse key must not log the user out"
        assert result["code"] == 102
        assert result["message"].startswith("Invalid Langfuse keys:")
        assert "correct host" in result["message"]
        assert calls["server_errors"] == []
        assert calls["saved"] == []

    def test_unreachable_host_returns_server_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Transport failures keep using the generic error path."""

        def _unreachable():
            raise ConnectionError("[Errno 111] Connection refused")

        module, calls = _load_api(monkeypatch, client=_Client(_unreachable))
        result = asyncio.run(module.set_api_key())

        assert result["kind"] == "server_error", result
        assert len(calls["server_errors"]) == 1
        assert calls["saved"] == []

    def test_valid_credentials_are_persisted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        module, calls = _load_api(monkeypatch, client=_Client(lambda: True))
        result = asyncio.run(module.set_api_key())

        assert result["kind"] == "json", result
        assert result["data"] == {"tenant_id": "tenant-1", **PAYLOAD}
        assert calls["saved"] == [{"tenant_id": "tenant-1", **PAYLOAD}]
        assert calls["server_errors"] == []


@pytest.mark.p1
class TestLangfuseApiKeyRead:
    def test_rejected_stored_credentials_report_message(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Reading back a stale key must answer with a message, not a 401."""

        def _reject():
            raise _ApiError({"message": "Invalid credentials."})

        module, calls = _load_api(monkeypatch, client=_Client(_reject), entry=ENTRY)
        result = module.get_api_key()

        assert result["kind"] == "json", result
        assert result["message"].startswith("Error from Langfuse:")
        assert "Invalid credentials." in result["message"]
        assert calls["server_errors"] == []
