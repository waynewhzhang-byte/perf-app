# Ubuntu 迁移部署脚本

用于将 **perf-app** 从源环境打包（源码 + 数据库全量 dump），在已具备 PostgreSQL、MinIO、PM2 的 Ubuntu 目标机上自动完成：依赖安装（国内镜像）、数据库恢复、Prisma 结构迁移、Next.js 构建、PM2 启动。

不包含 `node_modules`、`.next` 等构建产物；目标机现场安装依赖并构建。

**包管理器自动检测**：根据锁文件自动选择 `npm ci`（`package-lock.json`）或 `pnpm install --frozen-lockfile`（`pnpm-lock.yaml`），也可通过 `--use-npm` / `--use-pnpm` 强制指定。

## 文件说明

| 文件 | 执行位置 | 作用 |
|------|----------|------|
| `pack.sh` | 源机器 | 打包 `source/` + `database.dump` + 生成 `deploy.sh` |
| `deploy.sh` | 目标 Ubuntu（打包自动生成） | 一键部署入口（解压后直接 `sudo ./deploy.sh`） |
| `install-on-server.sh` | 目标 Ubuntu（被 deploy.sh 调用） | 同步源码、导入库、迁移、构建、PM2 |
| `ecosystem.config.cjs` | 目标机（由 install 调用） | PM2 配置 |
| `lib/common.sh` | 被上述脚本 source | 公共函数 |

## 一、源环境打包

```bash
cd /path/to/perf-app
chmod +x scripts/deploy/pack.sh scripts/deploy/install-on-server.sh

# 使用项目根目录 .env 中的 DATABASE_URL 执行 pg_dump
./scripts/deploy/pack.sh

# 指定环境与输出目录
./scripts/deploy/pack.sh --env-file .env --output-dir ./deploy-packages

# 内网传输可一并打入 .env（含密钥，慎用）
./scripts/deploy/pack.sh --include-env

# 仅源码、不 dump 数据库
./scripts/deploy/pack.sh --skip-dump
```

输出示例：`deploy-packages/perf-app-deploy-20260603-120000.tar.gz`

将压缩包传到目标机（`scp`、`rsync` 等）。若未使用 `--include-env`，请单独拷贝 `.env` 到目标机 `APP_DIR`（默认 `/opt/perf-app/.env`）或在部署时手动编辑生成的 `.env.example`。

## 二、目标 Ubuntu 部署

### 前置条件

- Node.js **18+**（推荐 **20 LTS**，自带 npm）
- `npm`（Node.js 自带）或 `pnpm`（`corepack enable`）
- PostgreSQL 客户端：`psql`、`pg_restore`
- 已运行的 PostgreSQL、MinIO（与 `.env` 一致）
- `pm2` 全局安装：`npm i -g pm2`（可用国内镜像）

`.env` 中至少配置：`DATABASE_URL`、`JWT_SECRET`、`NOTIFY_SECRET_KEY`、MinIO、`APP_BASE_URL`。可参考项目根目录 `.env.example`。

### 【推荐】一键部署

```bash
# 解压后直接运行根目录的 deploy.sh
tar -xzf perf-app-deploy-20260603-120000.tar.gz
cd perf-app-deploy-20260603-120000
sudo ./deploy.sh
```

### 【兼容】直接传归档路径

```bash
sudo ./install-on-server.sh /tmp/perf-app-deploy-20260603-120000.tar.gz
```

### 常用选项

| 选项 | 说明 |
|------|------|
| `--migrate-only` | 不导入 dump，仅 `prisma migrate deploy`（空库或保留现有数据） |
| `--skip-db-import` | 同 `--migrate-only` |
| `--skip-build` | 跳过项目构建 |
| `--skip-pm2` | 不操作 PM2，手动 `npm start` |
| `--use-npm` | 强制使用 npm（`npm ci`），即便 `pnpm-lock.yaml` 存在 |
| `--use-pnpm` | 强制使用 pnpm（`pnpm install`），即便 `package-lock.json` 存在 |

### 默认数据库流程

1. **pg_restore** 全库 custom-format dump（`--clean --if-exists`）
2. **prisma migrate deploy** 应用代码仓库中尚未在 dump 里执行的迁移

适用于：从旧版本库迁移到新代码结构。

### 国内镜像

`install-on-server.sh` 会自动设置：

| 镜像项 | 地址 |
|--------|------|
| npm registry | `https://registry.npmmirror.com` |
| Prisma 引擎 | `https://registry.npmmirror.com/-/binary/prisma` |

无论使用 npm 还是 pnpm，registry 都会自动切换。也可在运行前覆盖：

```bash
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
```

### 包管理器选择逻辑

1. 命令行 `--use-npm` / `--use-pnpm` 显式指定（最高优先级）
2. 检测锁文件：`package-lock.json` → npm，`pnpm-lock.yaml` → pnpm
3. 两个锁文件都存在 → 优先 npm（因为 `npm ci` 需要 `package-lock.json`）
4. 检测命令可用性：`npm` → `pnpm`
5. 默认回退到 npm

## 三、MinIO 附件

本脚本 **不迁移 MinIO 对象**。若附件需一并迁移，请在源机对 bucket 做 `mc mirror` 或文件级 rsync，目标路径与 `.env` 中 `MINIO_*` 一致。

## 四、验证

```bash
pm2 logs perf-app
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/
# 首次部署访问 /admin/setup 创建管理员（仅无 ADMIN 时）
```

## 五、故障排查

- **pg_restore 报错**：多为对象已不存在，脚本会继续执行 `migrate deploy`；若库损坏可 `dropdb` 后重跑 install。
- **Prisma migrate 失败**：检查 dump 与代码是否来自同一迁移链；必要时 `--migrate-only` 在空库仅跑迁移。
- **pnpm 未找到**：`corepack enable && corepack prepare pnpm@9 --activate`
- **连接 MinIO 超时**：生产同机部署时 `MINIO_ENDPOINT` 使用 `127.0.0.1`，见 `.env.example` 注释。
