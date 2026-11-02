#
#  版权所有 2025 The InfiniFlow Authors。保留所有权利.
#
#  根据 Apache 许可证 2.0 版（“本许可证”）获得许可;
#  除非遵守本许可证，否则您不得使用此文件.
#  您可以在以下位置获取本许可证的副本：
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  除非适用法律要求或书面同意，否则根据
#  本许可证分发的软件均按“原样”分发，
#  不附带任何明示或暗示的担保或条件。
#  请参阅本许可证以了解管理权限和
#  本许可证下的限制的具体语言.
#

from .oauth import OAuthClient
from .oidc import OIDCClient
from .github import GithubOAuthClient

#  允许的授权类型
CLIENT_TYPES = {"oauth2": OAuthClient, "oidc": OIDCClient, "github": GithubOAuthClient}


# 获取授权客户端
def get_auth_client(config) -> OAuthClient:
    channel_type = str(config.get("type", "")).lower()
    if channel_type == "":
        if config.get("issuer"):
            channel_type = "oidc"
        else:
            channel_type = "oauth2"
    client_class = CLIENT_TYPES.get(channel_type)
    if not client_class:
        raise ValueError(f"Unsupported type: {channel_type}")

    return client_class(config)
