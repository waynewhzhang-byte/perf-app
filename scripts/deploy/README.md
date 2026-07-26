# Ubuntu 迁移部署脚本

**完整执行说明：[MIGRATION.md](./MIGRATION.md)**

## 职责

| 手工准备 | 一键 `deploy.sh` |
|----------|------------------|
| Node.js + npm | 导库 + `npm ci` + `build` |
| PostgreSQL | 安装并配置 **PM2** |
| MinIO（本机 `:9000` HTTP） | 安装并配置 **Nginx + 自签名 SSL** |
| | 修正 `APP_BASE_URL` + **附件代理模式**（默认） |

不迁移 MinIO 对象；不安装 Node / PostgreSQL / MinIO。

## 命令

```bash
# 源机
./scripts/deploy/migrate.sh --include-env

# 目标机（环境已就绪）
tar -xzf perf-app-deploy-*.tar.gz && cd perf-app-deploy-*
sudo ./deploy.sh --server-name <服务器公网IP>

# 若已部署但仍无法打开附件（ERR_SSL_PROTOCOL_ERROR）
sudo ./fix-attachments.sh --server-name <服务器公网IP>
```

## 附件打不开？

截图若是 `ERR_SSL_PROTOCOL_ERROR` / 裂图，几乎总是：

`MINIO_PUBLIC_USE_SSL=true` + 端口仍是裸 MinIO **9000**（只讲 HTTP）。

**默认修复**：不设 `MINIO_PUBLIC_*`，走应用代理。

可选：`sudo ./scripts/deploy/setup-minio-nginx-ssl.sh --server-name <IP>` 后再用 `minio-https` 模式。

## 文件

| 文件 | 作用 |
|------|------|
| `migrate.sh` / `pack.sh` | 源机打包 |
| `install-on-server.sh` | 一键部署核心 |
| `configure-env.sh` | 写入合理 `.env`（附件模式） |
| `fix-attachments.sh` | 已部署机附件一键修复 |
| `setup-pm2-nginx.sh` | 仅 PM2 + Nginx |
| `setup-nginx-ssl.sh` | 主站自签名证书 |
| `setup-minio-nginx-ssl.sh` | MinIO HTTPS 反代（8443→9000） |
| `ecosystem.config.cjs` | PM2 配置 |
| `env.ubuntu.example` | `.env` 模板 |
