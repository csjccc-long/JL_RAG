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

import jwt
from common.http_client import sync_request
from .oauth import OAuthClient


#用于 OIDC ID 令牌的安全非对称签名算法
# 对称 HMAC 算法（HS*）被有意排除——当验证密钥是从提
# 供者的 JWKS 获取的非对称公钥时（所有 OIDC ID 令牌都是
# 如此），接受 HS256 会让攻击者利用公钥字节通过 HMAC
# 签名伪造令牌（RSA/HMAC 算法混淆攻击，CWE-347）。
# “none” 被排除的原因显而易见：它会完全禁用签名验证。

_ALLOWED_OIDC_SIGNING_ALGS = frozenset(
    {
        "RS256",
        "RS384",
        "RS512",
        "ES256",
        "ES384",
        "ES512",
        "PS256",
        "PS384",
        "PS512",
        "EdDSA",
    }
)

# OIDC Core 1.0 § 2 将 RS256 指定为规范默认的 id_token_signing_alg，
# 因此当提供方的发现文档未公布 id_token_signing_alg_values_supported（或仅公
# 布了安全允许列表之外的算法）时，
# 这是一个安全的回退选择。
_DEFAULT_OIDC_SIGNING_ALGS = ("RS256",)


def _resolve_id_token_signing_algs(metadata):
    """返回要传递给 jwt.decode(..., algorithms=...) 的算法列表。

        该函数会取提供方声明的 id_token_signing_alg_values_supported 与 :
        data:_ALLOWED_OIDC_SIGNING_ALGS 的交集。当提供方未声明该字段，或声明的算法全部不在安全允许列表内时，将回退到 :
        data:_DEFAULT_OIDC_SIGNING_ALGS —— 关键在于，回退算法为 RS256，绝不是验证时 JWT 头部所声称的任何算法。
    """
    advertised = metadata.get("id_token_signing_alg_values_supported") or []
    if not isinstance(advertised, (list, tuple)):
        advertised = []
    safe = [a for a in advertised if isinstance(a, str) and a in _ALLOWED_OIDC_SIGNING_ALGS]
    return safe or list(_DEFAULT_OIDC_SIGNING_ALGS)


class OIDCClient(OAuthClient):
    def __init__(self, config):
        """
        使用 issuer 作为配置发现的唯一可信源，以此初始化 OIDCClient 和提供商配置。
        """
        self.issuer = config.get("issuer")
        if not self.issuer:
            raise ValueError("Missing issuer in configuration.")

        oidc_metadata = self._load_oidc_metadata(self.issuer)
        config.update(
            {
                "issuer": oidc_metadata["issuer"],
                "jwks_uri": oidc_metadata["jwks_uri"],
                "authorization_url": oidc_metadata["authorization_endpoint"],
                "token_url": oidc_metadata["token_endpoint"],
                "userinfo_url": oidc_metadata["userinfo_endpoint"],
            }
        )

        super().__init__(config)
        self.issuer = config["issuer"]
        self.jwks_uri = config["jwks_uri"]
        # 在构造时固定已接受的 ID 令牌签名算法
        # 从可信来源（提供者元数据 + 安全允许列表）获取，以便
        # :meth:parse_id_token 中的 JWT 验证步骤不会被
        # 攻击者控制的 JWT 头部所欺骗（CWE-345 / CWE-347）
        self.id_token_signing_algs = _resolve_id_token_signing_algs(oidc_metadata)

    @staticmethod
    def _load_oidc_metadata(issuer):
        """
        从 `/.well-known/openid-configuration` 加载 OIDC 元数据。
        """
        try:
            metadata_url = f"{issuer}/.well-known/openid-configuration"
            response = sync_request("GET", metadata_url, timeout=7)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise ValueError(f"Failed to fetch OIDC metadata: {e}")

    def parse_id_token(self, id_token):
        """
        解析并验证 OIDC ID Token (JWT 格式) 与签名验证。

        接受的签名算法来自 ``self.id_token_signing_algs``
        (在构造时从提供商的发现元数据中固定，
        与 :data:`_ALLOWED_OIDC_SIGNING_ALGS` 取交集)。我们故意
        不从未经验证的 JWT 头部读取算法 —— 这样做会让攻击者通过设置
        ``"alg": "none"`` 来绕过签名验证，或者通过设置 ``"alg": "HS256"``
        并使用从提供商 JWKS 获取的公钥进行签名来制造经典的 RSA / HMAC 算法
        混淆 (CWE-345 / CWE-347)。
        """
        try:
            # 使用 PyJWT 的 PyJWKClient 来获取 JWKS 并查找签名密钥。
            # 客户端会从 JWT 头部内部读取 ``kid`` 来查找密钥 —— 这是没问题的：``kid`` 不是安全决策，签名仍然证明了使用了哪个密钥。
            jwks_cli = jwt.PyJWKClient(self.jwks_uri)
            signing_key = jwks_cli.get_signing_key_from_jwt(id_token).key

            # 解码并根据固定的允许列表验证签名。
            decoded_token = jwt.decode(
                id_token,
                key=signing_key,
                algorithms=list(self.id_token_signing_algs),
                audience=str(self.client_id),
                issuer=self.issuer,
            )
            return decoded_token
        except Exception as e:
            raise ValueError(f"Error parsing ID Token: {e}")

    def fetch_user_info(self, access_token, id_token=None, **kwargs):
        """
        获取用户信息。
        """
        user_info = {}
        if id_token:
            user_info = self.parse_id_token(id_token)
        user_info.update(super().fetch_user_info(access_token).to_dict())
        return self.normalize_user_info(user_info)

    async def async_fetch_user_info(self, access_token, id_token=None, **kwargs):
        user_info = {}
        if id_token:
            user_info = self.parse_id_token(id_token)
        user_info.update((await super().async_fetch_user_info(access_token)).to_dict())
        return self.normalize_user_info(user_info)

    def normalize_user_info(self, user_info):
        return super().normalize_user_info(user_info)
