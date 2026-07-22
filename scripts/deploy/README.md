# Ubuntu 迁移部署脚本

**完整执行说明：[MIGRATION.md](./MIGRATION.md)**

## 职责

| 手工准备 | 一键 `deploy.sh` |
|----------|------------------|
| Node.js + npm | 导库 + `npm ci` + `build` |
| PostgreSQL | 安装并配置 **PM2** |
| MinIO | 安装并配置 **Nginx + 自签名 SSL** |

不迁移 MinIO 对象；不安装 Node / PostgreSQL / MinIO。

## 命令

```bash
# 源机
./scripts/deploy/migrate.sh --include-env

# 目标机（环境已就绪）
tar -xzf perf-app-deploy-*.tar.gz && cd perf-app-deploy-*
sudo ./deploy.sh --server-name <服务器IP>
```

## 文件

| 文件 | 作用 |
|------|------|
| `migrate.sh` / `pack.sh` | 源机打包 |
| `install-on-server.sh` | 一键部署核心 |
| `setup-pm2-nginx.sh` | 仅 PM2 + Nginx |
| `setup-nginx-ssl.sh` | 自签名证书 |
| `bootstrap-ubuntu.sh` | 兼容 → setup-pm2-nginx |
| `ecosystem.config.cjs` | PM2 配置 |
| `env.ubuntu.example` | `.env` 模板 |
