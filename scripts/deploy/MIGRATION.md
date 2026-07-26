# perf-app Ubuntu 迁移执行说明

> 目标机 **自行安装** Node.js/npm、PostgreSQL、MinIO。  
> 一键部署只负责：**导库 + 构建 + 安装配置 PM2 + Nginx（自签名 HTTPS）+ 附件访问 env**。  
> **不迁移 MinIO 对象**；只迁移完整源码 + PostgreSQL 数据。

---

## 0. 职责划分

| 谁做 | 内容 |
|------|------|
| **你方手工** | 安装 Node.js 20+ / npm、PostgreSQL、MinIO；准备好可连通的库与对象存储 |
| **一键 `deploy.sh`** | 同步源码、恢复 `database.dump`、`npm ci` + `build`、安装配置 **PM2**、安装配置 **Nginx + 自签名证书**、按 `--server-name` **修正附件访问配置**、启动应用 |
| **不迁** | MinIO 附件对象；不安装 Node / PostgreSQL / MinIO |

默认对齐配置：

```text
DATABASE_URL=postgresql://perf:perf@127.0.0.1:5432/perf?schema=public
MINIO_ENDPOINT=127.0.0.1  MINIO_PORT=9000  MINIO_USE_SSL=false
# 不设置 MINIO_PUBLIC_*  → 附件经应用代理（推荐）
APP_BASE_URL=https://<SERVER_NAME>
MINIO_ACCESS_KEY=minioadmin  MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=perf-attachments
```

占位符：

| 占位符 | 示例 |
|--------|------|
| `<SRC_DIR>` | 源机项目路径 |
| `<UBUNTU_USER>@<UBUNTU_HOST>` | `ubuntu@1.92.206.86` |
| `<SERVER_NAME>` | `1.92.206.86`（Nginx/证书名，填公网 IP 或域名） |

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

`--include-env` 会自动注释源机 `MINIO_PUBLIC_*`，避免把错误的 HTTPS→9000 配置带到 Ubuntu。

---

## 2. 【目标机】手工准备（一键部署前必须完成）

请确认：

```bash
node -v          # >= 18，推荐 20 LTS
npm -v
psql --version
pg_restore --version
# PostgreSQL 可登录，库用户与 .env 一致
# MinIO 在 127.0.0.1:9000（HTTP）可访问：
curl -sI http://127.0.0.1:9000/minio/health/live
```

`.env` 中 `DATABASE_URL` / `MINIO_*` 必须指向你已装好的服务。若打包使用了 `--include-env`，部署时会自动写入 `/opt/perf-app/.env`，请再核对主机是否仍是 `127.0.0.1`。

**MinIO 务必对本机开放 HTTP 9000**；不要把浏览器预签名直接指到 `https://公网IP:9000`。

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
3. **按 `--server-name` 写入 `APP_BASE_URL=https://...`，默认附件模式 `proxy`（注释 `MINIO_PUBLIC_*`）**  
4. `npm ci` → `pg_restore` → `prisma migrate deploy` → `npm run build`  
5. `npm i -g pm2`（若无）并用 cluster 启动  
6. 安装 Nginx（若无）并配置自签名 HTTPS 反代到 `:3000`  

### 常用选项

```bash
sudo ./deploy.sh --server-name 1.92.206.86
sudo ./deploy.sh --server-name 1.92.206.86 --instances 2
sudo ./deploy.sh --server-name 1.92.206.86 --skip-nginx    # 已有反代
sudo ./deploy.sh --migrate-only                             # 不导 dump，只 migrate
sudo ./deploy.sh --skip-pm2 --skip-nginx                    # 仅应用构建+导库

# 可选：浏览器直连 MinIO（Nginx 8443 HTTPS → 本机 9000）
sudo ./deploy.sh --server-name 1.92.206.86 \
  --attachment-mode minio-https --setup-minio-nginx
```

### 仅配置 PM2 / Nginx（可选）

```bash
sudo ./bootstrap.sh --server-name <SERVER_NAME>
```

---

## 5. 验证

```bash
pm2 status
pm2 logs perf-app --lines 50
curl -s -o /dev/null -w "app:%{http_code}\n" http://127.0.0.1:3000/
curl -k -s -o /dev/null -w "https:%{http_code}\n" https://<SERVER_NAME>/
curl -sI http://127.0.0.1:9000/minio/health/live
```

浏览器打开：`https://<SERVER_NAME>/`（自签名需点继续）。

建议：

```bash
pm2 save
# 按 pm2 提示执行一条 startup 命令，保证开机自启
```

---

## 6. `.env` 与附件访问

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 指向目标机已装好的 PostgreSQL |
| `MINIO_ENDPOINT` | 同机必须 `127.0.0.1`，`MINIO_USE_SSL=false` |
| `MINIO_PUBLIC_*` | **默认不要设置**（附件走应用代理） |
| `APP_BASE_URL` | 设为 `https://<SERVER_NAME>` |
| `JWT_SECRET` / `NOTIFY_SECRET_KEY` | 恢复旧库时须与源环境一致 |

### 两种附件模式

| 模式 | 配置 | 适用 |
|------|------|------|
| **proxy（默认）** | 不设 `MINIO_PUBLIC_*` | 最稳；与站点同域 HTTPS |
| **minio-https** | `PUBLIC`=域名 + 端口 **8443** + `USE_SSL=true`，且 Nginx 已反代 | 需直连对象存储时 |

---

## 7. 故障排查

| 现象 | 处理 |
|------|------|
| 提示未安装 Node / psql | 先手工装好再跑 `deploy.sh` |
| 无法连接 PostgreSQL | 检查服务、`DATABASE_URL`、本机认证 |
| MinIO 上传失败 | 检查 MinIO 服务与 `MINIO_ENDPOINT=127.0.0.1` |
| HTTPS 502 | `pm2 status`；`curl http://127.0.0.1:3000`；`sudo nginx -t` |
| **附件裂图 / `ERR_SSL_PROTOCOL_ERROR`** | 见下一节 |
| `npm ci` 失败（lock 不同步） | 使用新迁移包；或在 `/opt/perf-app` 执行 `npm install` 后重跑 |

### 7.1 附件打不开（与你截图一致）

浏览器报 **「此站点的连接不安全 / ERR_SSL_PROTOCOL_ERROR」**，地址类似 `https://1.92.206.86:9000/...`：

根因：预签名 URL 对 **HTTP 的 MinIO:9000** 使用了 **HTTPS**。

**已部署机一键修复（推荐）：**

```bash
# 在部署包目录，或 /opt/perf-app/scripts/deploy/
sudo ./fix-attachments.sh --server-name 1.92.206.86
# 等同:
sudo /opt/perf-app/scripts/deploy/fix-attachments.sh --server-name 1.92.206.86
```

这会：

1. 把 `MINIO_ENDPOINT` 固定为 `127.0.0.1:9000` HTTP  
2. **注释掉**错误的 `MINIO_PUBLIC_*`（改回应用代理）  
3. 设置 `APP_BASE_URL=https://1.92.206.86`  
4. `pm2 restart perf-app --update-env`  

然后硬刷新浏览器再打开附件。Network 里 `viewUrl` 应类似：

```text
/api/attachments/<id>/view?proxy=1
```

**可选：坚持直连 MinIO**

```bash
sudo ./scripts/deploy/setup-minio-nginx-ssl.sh --server-name 1.92.206.86
sudo ./fix-attachments.sh --server-name 1.92.206.86 \
  --attachment-mode minio-https --setup-minio-nginx
# 放行安全组 TCP 8443
```

注意：迁移包**默认不拷贝 MinIO 对象**。若目标机桶是空的，附件元数据在 PG 里但对象不存在，也会打不开——需另行 `mc mirror` 迁桶。

---

## 8. 脚本索引

| 文件 | 作用 |
|------|------|
| `migrate.sh` / `pack.sh` | 源机打包 |
| `install-on-server.sh` | 一键部署核心（由 `deploy.sh` 调用） |
| `configure-env.sh` | 写入合理 `.env`（附件模式） |
| `fix-attachments.sh` | 已部署机附件一键修复 |
| `setup-pm2-nginx.sh` | 仅装 PM2 + Nginx |
| `setup-nginx-ssl.sh` | 自签名证书 + 主站 Nginx |
| `setup-minio-nginx-ssl.sh` | MinIO HTTPS 反代（8443→9000） |
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

### 已部署但附件打不开

```bash
sudo ./fix-attachments.sh --server-name <SERVER_NAME>
# 硬刷新浏览器后重试打开附件
```
