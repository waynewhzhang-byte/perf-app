#!/usr/bin/env bash
# 在「源环境」（开发机或旧服务器）执行：打包源代码 + PostgreSQL 全库 dump，不含 node_modules / .next 构建产物。
#
# 用法:
#   ./scripts/deploy/pack.sh
#   ./scripts/deploy/pack.sh --env-file /path/to/.env
#   ./scripts/deploy/pack.sh --output-dir ./deploy-packages
#
# 依赖: pg_dump、tar、（可选）git

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/deploy-packages}"
INCLUDE_ENV=false
SKIP_DUMP=false

usage() {
  sed -n '2,12p' "$0"
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
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --include-env)
      INCLUDE_ENV=true
      shift
      ;;
    --skip-dump)
      SKIP_DUMP=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
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

# rsync 比 tar 排除更直观；无 rsync 时回退 tar
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
    . | tar -C "$SRC_DIR" -xf -
fi

cp "$ROOT_DIR/.env.example" "${BUNDLE_ROOT}/.env.example"

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
# deploy.sh — 一键部署入口（位于解压后的 bundle 根目录）
# 用法: sudo ./deploy.sh [选项]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/source/scripts/deploy/install-on-server.sh" --bundle-dir "$SCRIPT_DIR" "$@"
DEPLOYEOF
chmod +x "${BUNDLE_ROOT}/deploy.sh"
log "已生成 deploy.sh（解压后一键部署入口）"

cat > "${BUNDLE_ROOT}/MANIFEST.txt" <<EOF
perf-app 部署包
生成时间: $(date -Iseconds)
Git: ${GIT_REV}
源目录: ${ROOT_DIR}
包含: 源代码（无 node_modules/.next）$([ "$SKIP_DUMP" = true ] && echo '，不含数据库 dump' || echo '，含 database.dump')

【一键部署】:
  tar -xzf ${BUNDLE_NAME}.tar.gz
  cd ${BUNDLE_NAME}
  sudo ./deploy.sh

  常用选项:
  sudo ./deploy.sh --app-dir /opt/perf-app --use-npm
  sudo ./deploy.sh --migrate-only
EOF

ARCHIVE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
log "压缩 -> ${ARCHIVE_PATH}"
# 剥离 macOS 扩展属性和资源分支，避免 Ubuntu 上解压时报警告
export COPYFILE_DISABLE=1
tar --no-xattrs -C "$WORK_DIR" -czf "$ARCHIVE_PATH" "$BUNDLE_NAME"
rm -rf "$WORK_DIR"

# 生成 SHA256 校验文件（目标机上 sha256sum -c 验证完整性）
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ARCHIVE_PATH" | sed 's|.*/||' > "${ARCHIVE_PATH}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE_PATH" | sed 's|.*/||' > "${ARCHIVE_PATH}.sha256"
fi

log "完成: ${ARCHIVE_PATH}"
[[ -f "${ARCHIVE_PATH}.sha256" ]] && log "校验: ${ARCHIVE_PATH}.sha256"
log "部署步骤: 将 .tar.gz 和 .sha256 传到目标机 → sha256sum -c → tar -xzf → sudo ./deploy.sh"
