# perf-app Ubuntu 迁移执行说明

> 目标机 **自行安装** Node.js/npm、PostgreSQL、MinIO。  
> 一键部署只负责：**导库 + 构建 + 安装配置 PM2 + Nginx（自签名 HTTPS）**。  
> **不迁移 MinIO 对象**；只迁移完整源码 + PostgreSQL 数据。

---

## 0. 职责划分

| 谁做 | 内容 |
|------|------|
| **你方手工** | 安装 Node.js 20+ / npm、PostgreSQL、MinIO；准备好可连通的库与对象存储 |
| **一键 `deploy.sh`** | 同步源码、恢复 `database.dump`、`npm ci` + `build`、安装配置 **PM2**、安装配置 **Nginx + 自签名证书**、启动应用 |
| **不迁** | MinIO 附件对象；不安装 Node / PostgreSQL / MinIO |

默认对齐配置：

```text
DATABASE_URL=postgresql://perf:perf@127.0.0.1:5432/perf?schema=public
MINIO_ENDPOINT=127.0.0.1  MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin  MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=perf-attachments
```

占位符：

| 占位符 | 示例 |
|--------|------|
| `<SRC_DIR>` | 源机项目路径 |
| `<UBUNTU_USER>@<UBUNTU_HOST>` | `ubuntu@192.168.1.10` |
| `<SERVER_NAME>` | `192.168.1.10`（Nginx/证书名） |

---

## 1. 【源机】打包

```bash
cd <SRC_DIR>
chmod +x scripts/deploy/*.sh
./scripts/deploy/migrate.sh --include-env
```

产物：

```text
deploy-packages/perf-app-deploy-YYYYMMDD-HHMMSS.tar.gz
deploy-packages/perf-app-deploy-YYYYMMDD-HHMMSS.tar.gz.sha256
```

---

## 2. 【目标机】手工准备（一键部署前必须完成）

请确认：

```bash
node -v          # >= 18，推荐 20 LTS
npm -v
psql --version
pg_restore --version
# PostgreSQL 可登录，库用户与 .env 一致
# MinIO 在 127.0.0.1:9000（或你的地址）可访问
```

`.env` 中 `DATABASE_URL` / `MINIO_*` 必须指向你已装好的服务。若打包使用了 `--include-env`，部署时会自动写入 `/opt/perf-app/.env`，请再核对主机是否仍是 `127.0.0.1`。

---

## 3. 【传输】拷到 Ubuntu

```bash
scp <SRC_DIR>/deploy-packages/perf-app-deploy-*.tar.gz* \
    <UBUNTU_USER>@<UBUNTU_HOST>:/tmp/
```

```bash
ssh <UBUNTU_USER>@<UBUNTU_HOST>
cd /tmp
sha256sum -c perf-app-deploy-*.tar.gz.sha256
tar -xzf perf-app-deploy-YYYYMMDD-HHMMSS.tar.gz
cd perf-app-deploy-YYYYMMDD-HHMMSS
```

---

## 4. 【目标机】一键部署

```bash
sudo ./deploy.sh --server-name <SERVER_NAME>
```

该命令会依次：

1. 检查 Node / npm / `psql` / `pg_restore`（**不安装**它们）  
2. 同步源码到 `/opt/perf-app`，应用 `.env.packaged`（若有）  
3. `npm ci` → `pg_restore` → `prisma migrate deploy` → `npm run build`  
4. `npm i -g pm2`（若无）并用 cluster 启动  
5. 安装 Nginx（若无）并配置自签名 HTTPS 反代到 `:3000`  

### 常用选项

```bash
sudo ./deploy.sh --server-name 192.168.1.10
sudo ./deploy.sh --server-name 192.168.1.10 --instances 2
sudo ./deploy.sh --server-name 192.168.1.10 --skip-nginx    # 已有反代
sudo ./deploy.sh --migrate-only                             # 不导 dump，只 migrate
sudo ./deploy.sh --skip-pm2 --skip-nginx                    # 仅应用构建+导库
```

### 仅配置 PM2 / Nginx（可选）

一般不必单独跑；若只要补装：

```bash
sudo ./bootstrap.sh --server-name <SERVER_NAME>
# 等同
sudo ./bootstrap/setup-pm2-nginx.sh --server-name <SERVER_NAME>
```

---

## 5. 验证

```bash
pm2 status
pm2 logs perf-app --lines 50
curl -s -o /dev/null -w "app:%{http_code}\n" http://127.0.0.1:3000/
curl -k -s -o /dev/null -w "https:%{http_code}\n" https://<SERVER_NAME>/
```

浏览器打开：`https://<SERVER_NAME>/`（自签名需点继续）。

建议：

```bash
pm2 save
# 按 pm2 提示执行一条 startup 命令，保证开机自启
```

---

## 6. `.env` 注意点

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 指向目标机已装好的 PostgreSQL |
| `MINIO_*` | 指向目标机已装好的 MinIO（同机用 `127.0.0.1`） |
| `APP_BASE_URL` | 设为 `https://<SERVER_NAME>` |
| `JWT_SECRET` / `NOTIFY_SECRET_KEY` | 恢复旧库时须与源环境一致（否则通知配置无法解密） |

---

## 7. 故障排查

| 现象 | 处理 |
|------|------|
| 提示未安装 Node / psql | 先手工装好再跑 `deploy.sh` |
| 无法连接 PostgreSQL | 检查服务、`DATABASE_URL`、本机认证 |
| MinIO 上传失败 | 检查 MinIO 服务与 `MINIO_ENDPOINT=127.0.0.1` |
| HTTPS 502 | `pm2 status`；`curl http://127.0.0.1:3000`；`sudo nginx -t` |
| `npm ci` 失败（lock 不同步） | 使用新迁移包（已同步 `package-lock.json`）；或在 `/opt/perf-app` 执行 `npm install` 后重跑 `deploy.sh --skip-db-import`（若库已导入） |

---

## 8. 脚本索引

| 文件 | 作用 |
|------|------|
| `migrate.sh` / `pack.sh` | 源机打包 |
| `install-on-server.sh` | 一键部署核心（由 `deploy.sh` 调用） |
| `setup-pm2-nginx.sh` | 仅装 PM2 + Nginx |
| `setup-nginx-ssl.sh` | 自签名证书 + Nginx 站点 |
| `bootstrap-ubuntu.sh` | 兼容入口 → `setup-pm2-nginx.sh` |
| `ecosystem.config.cjs` | PM2 cluster 配置 |
| `env.ubuntu.example` | `.env` 模板 |

---

## 9. 命令抄写板

### 源机

```bash
cd <SRC_DIR>
./scripts/deploy/migrate.sh --include-env
scp deploy-packages/perf-app-deploy-*.tar.gz* <UBUNTU_USER>@<UBUNTU_HOST>:/tmp/
```

### 目标机（Node / PG / MinIO 已就绪）

```bash
cd /tmp
tar -xzf perf-app-deploy-YYYYMMDD-HHMMSS.tar.gz
cd perf-app-deploy-YYYYMMDD-HHMMSS
sudo ./deploy.sh --server-name <SERVER_NAME>
pm2 status
curl -k -I https://<SERVER_NAME>/
```
