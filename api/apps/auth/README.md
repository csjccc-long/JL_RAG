# 认证

Auth 模块提供了 OAuth2 和 OpenID Connect (OIDC) 认证的实现，用于与第三方身份提供商集成。

**功能特性**

- 支持 OAuth2 和 OIDC 认证协议
- 自动 OIDC 配置发现（通过 `/.well-known/openid-configuration`）
- JWT 令牌验证
- 统一的用户信息处理

## 使用方法

```python
# OAuth2 配置
oauth_config = {
    "type": "oauth2",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "authorization_url": "https://your-oauth-provider.com/oauth/authorize",
    "token_url": "https://your-oauth-provider.com/oauth/token",
    "userinfo_url": "https://your-oauth-provider.com/oauth/userinfo",
    "redirect_uri": "https://your-app.com/api/v1/auth/oauth/<channel>/callback"
}

# OIDC 配置
oidc_config = {
    "type": "oidc",
    "issuer": "https://your-oauth-provider.com/oidc",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "redirect_uri": "https://your-app.com/api/v1/auth/oauth/<channel>/callback"
}

# GitHub OAuth 配置
github_config = {
    "type": "github",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "redirect_uri": "https://your-app.com/v1/user/oauth/callback/<channel>"
}

# 获取客户端实例
client = get_auth_client(oauth_config)
```

### 认证流程

1. 获取授权 URL：
```python
auth_url = client.get_authorization_url()
```

2. 用户授权后，用授权码交换令牌：
```python
token_response = client.exchange_code_for_token(authorization_code)
access_token = token_response["access_token"]
```

3. 获取用户信息：
```python
user_info = client.fetch_user_info(access_token)
```

## 用户信息结构

所有认证方法返回的用户信息均遵循以下结构：

```python
{
    "email": "user@example.com",
    "username": "username",
    "nickname": "User Name",
    "avatar_url": "https://example.com/avatar.jpg"
}
```
