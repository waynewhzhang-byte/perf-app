#!/usr/bin/env bash
# 在「源环境」（开发机或旧服务器）执行：打包完整源代码 + PostgreSQL 全库 dump。
# 不含 node_modules / .next；目标机现场 npm ci + build。
# 不包含 MinIO 对象数据（目标机仅需同配置的空 MinIO 服务）。
#
# 用法:
#   ./scripts/deploy/pack.sh
#   ./scripts/deploy/pack.sh --env-file /path/to/.env
#   ./scripts/deploy/pack.sh --output-dir ./deploy-packages
#   ./scripts/deploy/pack.sh --include-env
#
# 依赖: pg_dump、tar、（可选）rsync / git

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/deploy-packages}"
INCLUDE_ENV=false
SKIP_DUMP=false

usage() {
  sed -n '2,14p' "$0"
  echo ""
  echo "选项:"
  echo "  --env-file PATH     读取 DATABASE_URL（默认: 项目根目录 .env）"
  echo "  --output-dir PATH   输出目录（默认: ./deploy-packages）"
  echo "  --include-env       将 .env 打入包内（含密钥，仅内网迁移时慎用）"
  echo "  --skip-dump         仅打源码包，不执行 pg_dump"
  echo "  -h, --help          显示帮助"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --include-env) INCLUDE_ENV=true; shift ;;
    --skip-dump) SKIP_DUMP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

require_cmd tar
require_cmd pg_dump

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/perf-app-pack.XXXXXX")"
BUNDLE_NAME="perf-app-deploy-${STAMP}"
BUNDLE_ROOT="${WORK_DIR}/${BUNDLE_NAME}"
SRC_DIR="${BUNDLE_ROOT}/source"

mkdir -p "$SRC_DIR" "$OUTPUT_DIR"

log "打包源代码 -> ${SRC_DIR}"

if command -v rsync >/dev/null 2>&1; then
  rsync -a \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude 'deploy-packages' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.env.*.local' \
    --exclude 'coverage' \
    --exclude '.turbo' \
    --exclude '.codegraph' \
    --exclude '*.tar.gz' \
    --exclude 'minio-data' \
    "$ROOT_DIR/" "$SRC_DIR/"
else
  log "未找到 rsync，使用 tar 打包（较慢）"
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT_DIR" -cf - \
    --exclude=node_modules \
    --exclude=.next \
    --exclude=.git \
    --exclude=deploy-packages \
    --exclude=.env \
    --exclude=.env.local \
    --exclude=coverage \
    --exclude=.turbo \
    --exclude=.codegraph \
    --exclude=minio-data \
    . | tar -C "$SRC_DIR" -xf -
fi

cp "$ROOT_DIR/.env.example" "${BUNDLE_ROOT}/.env.example"
# 一并带上 Ubuntu 示例 env 与部署脚本说明
if [[ -f "$ROOT_DIR/scripts/deploy/env.ubuntu.example" ]]; then
  cp "$ROOT_DIR/scripts/deploy/env.ubuntu.example" "${BUNDLE_ROOT}/env.ubuntu.example"
fi

if [[ "$INCLUDE_ENV" == true ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    die "未找到 --include-env 所需的文件: $ENV_FILE"
  fi
  cp "$ENV_FILE" "${BUNDLE_ROOT}/.env.packaged"
  log "已包含 .env -> .env.packaged（请妥善保管传输包）"
fi

if [[ "$SKIP_DUMP" == false ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    die "需要数据库 dump 但未找到环境文件: $ENV_FILE（可用 --skip-dump 跳过）"
  fi
  load_database_url_from_env "$ENV_FILE"
  log "执行 pg_dump -> ${BUNDLE_ROOT}/database.dump"
  pg_dump "${PGDUMP_OPTS[@]}" -Fc -f "${BUNDLE_ROOT}/database.dump" "$PGDATABASE"
  log "数据库 dump 完成 ($(du -h "${BUNDLE_ROOT}/database.dump" | cut -f1))"
else
  log "已跳过 pg_dump（--skip-dump）"
fi

GIT_REV="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_REV="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi

cat > "${BUNDLE_ROOT}/deploy.sh" <<'DEPLOYEOF'
#!/usr/bin/env bash
# deploy.sh — 目标机一键部署（假定 Node/npm、PostgreSQL、MinIO 已手工装好）
# 本脚本: 导库 + npm ci/build + 安装配置 PM2 + Nginx 自签名 SSL
# 用法:
#   sudo ./deploy.sh --server-name 192.168.1.10
#   sudo ./deploy.sh --server-name example.com --skip-nginx
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/source/scripts/deploy/install-on-server.sh" \
  --bundle-dir "$SCRIPT_DIR" --use-npm "$@"
DEPLOYEOF
chmod +x "${BUNDLE_ROOT}/deploy.sh"
log "已生成 deploy.sh（一键部署：应用 + PM2 + Nginx）"

# 复制 PM2/Nginx 配置脚本到 bundle（不装 Node/PG/MinIO）
mkdir -p "${BUNDLE_ROOT}/bootstrap"
for f in setup-pm2-nginx.sh setup-nginx-ssl.sh bootstrap-ubuntu.sh env.ubuntu.example; do
  [[ -f "$ROOT_DIR/scripts/deploy/$f" ]] && cp "$ROOT_DIR/scripts/deploy/$f" "${BUNDLE_ROOT}/bootstrap/"
done
cp -a "$ROOT_DIR/scripts/deploy/nginx" "${BUNDLE_ROOT}/bootstrap/" 2>/dev/null || true
cp -a "$ROOT_DIR/scripts/deploy/lib" "${BUNDLE_ROOT}/bootstrap/" 2>/dev/null || true

cat > "${BUNDLE_ROOT}/bootstrap.sh" <<'BOOTEOF'
#!/usr/bin/env bash
# 仅安装/配置 PM2 + Nginx（不装 Node / PostgreSQL / MinIO）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${ROOT}/bootstrap/setup-pm2-nginx.sh" "$@"
BOOTEOF
chmod +x "${BUNDLE_ROOT}/bootstrap.sh"

cat > "${BUNDLE_ROOT}/MANIFEST.txt" <<EOF
perf-app 迁移包（完整源码 + PostgreSQL dump）
生成时间: $(date -Iseconds)
Git: ${GIT_REV}
源目录: ${ROOT_DIR}

【目标机需已手工安装】
  - Node.js 20+ 与 npm
  - PostgreSQL（与 .env DATABASE_URL 一致）
  - MinIO（与 .env MINIO_* 一致；不迁移对象数据）
  - psql / pg_restore / rsync

【一键部署会做】
  - 同步源码、导入 database.dump、prisma migrate、npm ci + build
  - 安装并配置 PM2（cluster）
  - 安装并配置 Nginx + 自签名 HTTPS

包含:
  - source/          完整源代码（无 node_modules / .next）
  - database.dump    PostgreSQL 全库 dump（除非 --skip-dump）
  - deploy.sh        一键部署入口
  - bootstrap.sh     仅 PM2 + Nginx（一般不必单独跑，deploy.sh 已包含）

【推荐流程】:
  tar -xzf ${BUNDLE_NAME}.tar.gz
  cd ${BUNDLE_NAME}
  # 确认目标机 .env 中 DATABASE_URL / MINIO_* / APP_BASE_URL
  sudo ./deploy.sh --server-name <服务器IP或域名>
EOF

ARCHIVE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
log "压缩 -> ${ARCHIVE_PATH}"
export COPYFILE_DISABLE=1
tar --no-xattrs -C "$WORK_DIR" -czf "$ARCHIVE_PATH" "$BUNDLE_NAME"
rm -rf "$WORK_DIR"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ARCHIVE_PATH" | sed 's|.*/||' > "${ARCHIVE_PATH}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE_PATH" | sed 's|.*/||' > "${ARCHIVE_PATH}.sha256"
fi

log "完成: ${ARCHIVE_PATH}"
[[ -f "${ARCHIVE_PATH}.sha256" ]] && log "校验: ${ARCHIVE_PATH}.sha256"
log "下一步: 传到目标机 → tar -xzf → sudo ./deploy.sh --server-name <IP>"
