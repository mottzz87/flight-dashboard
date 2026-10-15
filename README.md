# flight-dashboard

东京 ⇄ 成都往返机票价格看板（自建版）。纯静态页面，数据来自自建的
[flight-prices](https://ops.nnde.de/flights/api) 接口，每 3 小时由监控任务写入一批。

- 4 个日期组合切换（去程 12/17、12/18 × 返程 1/10、1/11）
- 当前最低价 / 直飞 / 最快三个维度
- 每日最低价走势图（Canvas，无依赖）
- 每日汇总：每天最低价、直飞最低价各一条，可展开看行程明细
- 筛选条件：单程最多中转 1 次 · 去程 23:00 前到达 · 单程 ≤ 12 小时

## 本地预览

```bash
cd flight-dashboard
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

API 地址写在 `js/app.js` 顶部的 `API` 常量里，换环境改那一行即可。

## 部署

`main` 分支每次 push 自动部署到 Oracle 服务器（GitHub Actions +
appleboy/ssh-action，沿用 tennis-bot 那套模式）。

### 1. 在 GitHub 仓库设置 Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 说明 | 示例值 |
|---|---|---|
| `DEPLOY_HOST` | 服务器公网 IP | `xxx.xxx.xxx.22` |
| `SSH_USER` | SSH 用户 | `root` |
| `SSH_PORT` | SSH 端口 | `22` |
| `SSH_PRIVATE_KEY` | 部署私钥（`-----BEGIN OPENSSH PRIVATE KEY-----` 整段） | — |
| `DEPLOY_DIR` | 服务器上的部署目录 | `/home/admin/apps/ops-tools/flight-dashboard` |

> 私钥单独生成一对部署密钥即可：`ssh-keygen -t ed25519 -f ~/.ssh/dashboard_deploy`，
> 把 `.pub` 加到服务器 `~/.ssh/authorized_keys`，私钥整段贴进 `SSH_PRIVATE_KEY`。

### 2. 服务器上配 Nginx（静态托管）

把 `nginx-snippet.conf` 的内容加到 `/etc/nginx/sites-enabled/ops` 的 443
server 块内（`alias` 路径换成 `DEPLOY_DIR` 的实际值），然后：

```bash
nginx -t && systemctl reload nginx
```

配好后访问 `https://ops.nnde.de/flight-dashboard/`。

### 部署流程说明

Action 通过 SSH 登录后：如果 `DEPLOY_DIR/.git` 已存在就 `git pull --ff-only`，
否则 `git clone` 本仓库。纯静态文件，无需构建、不用重启服务。
