#!/usr/bin/env bash
# migrate.sh — 源环境「一键打包」：源码 + PG dump，可选传到目标机并远程 deploy
#
# 目标机需已手工安装: Node/npm、PostgreSQL、MinIO
# 远程 deploy 仅负责: 导库 + 构建 + PM2 + Nginx
#
# 用法:
#   ./scripts/deploy/migrate.sh
#   ./scripts/deploy/migrate.sh --include-env
#   ./scripts/deploy/migrate.sh --remote user@ubuntu --run-remote --server-name 192.168.1.10

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/deploy-packages}"
INCLUDE_ENV=false
SKIP_DUMP=false
REMOTE=""
REMOTE_DIR="/tmp"
RUN_REMOTE=false
SERVER_NAME=""

usage() {
  cat <<'EOF'
用法: ./scripts/deploy/migrate.sh [选项]

源机打包:
  --env-file PATH       DATABASE_URL 来源（默认项目 .env）
  --output-dir PATH     输出目录（默认 ./deploy-packages）
  --include-env         打入 .env（含密钥，内网慎用）
  --skip-dump           不 dump 数据库

传到目标机:
  --remote user@host    scp 传输压缩包
  --remote-dir PATH     目标机目录（默认 /tmp）
  --run-remote          传输后 SSH 执行 deploy.sh（需目标机已装 Node/PG/MinIO）
  --server-name NAME    Nginx/证书名（传给远程 deploy）

  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --include-env) INCLUDE_ENV=true; shift ;;
    --skip-dump) SKIP_DUMP=true; shift ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --run-remote) RUN_REMOTE=true; shift ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

PACK_ARGS=(--env-file "$ENV_FILE" --output-dir "$OUTPUT_DIR")
[[ "$INCLUDE_ENV" == true ]] && PACK_ARGS+=(--include-env)
[[ "$SKIP_DUMP" == true ]] && PACK_ARGS+=(--skip-dump)

log "===== 源机打包（源码 + PostgreSQL）====="
bash "${SCRIPT_DIR}/pack.sh" "${PACK_ARGS[@]}"

ARCHIVE="$(ls -t "${OUTPUT_DIR}"/perf-app-deploy-*.tar.gz 2>/dev/null | head -n1 || true)"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || die "未找到打包产物"
log "打包产物: ${ARCHIVE}"

if [[ -z "$REMOTE" ]]; then
  log ""
  log "打包完成。目标机需已手工安装 Node/npm、PostgreSQL、MinIO，然后:"
  log "  scp ${ARCHIVE}* user@ubuntu:/tmp/"
  log "  ssh user@ubuntu"
  log "  cd /tmp && tar -xzf $(basename "$ARCHIVE") && cd perf-app-deploy-*"
  log "  sudo ./deploy.sh --server-name <服务器公网IP>"
  log "  # 若附件打不开（ERR_SSL_PROTOCOL_ERROR）:"
  log "  sudo ./fix-attachments.sh --server-name <服务器公网IP>"
  exit 0
fi

require_cmd scp
require_cmd ssh

log "===== 传输到 ${REMOTE}:${REMOTE_DIR} ====="
ssh "$REMOTE" "mkdir -p '${REMOTE_DIR}'"
scp "$ARCHIVE" "${REMOTE}:${REMOTE_DIR}/"
[[ -f "${ARCHIVE}.sha256" ]] && scp "${ARCHIVE}.sha256" "${REMOTE}:${REMOTE_DIR}/"

BASE="$(basename "$ARCHIVE")"
BUNDLE_DIR="${BASE%.tar.gz}"

if [[ "$RUN_REMOTE" != true ]]; then
  log "已传输。目标机执行:"
  log "  cd ${REMOTE_DIR} && tar -xzf ${BASE} && cd ${BUNDLE_DIR}"
  log "  sudo ./deploy.sh --server-name <IP或域名>"
  exit 0
fi

SERVER_ARG=""
[[ -n "$SERVER_NAME" ]] && SERVER_ARG="--server-name ${SERVER_NAME}"

log "===== 远程执行 deploy（PM2 + Nginx + 应用）====="
ssh -t "$REMOTE" "set -euo pipefail
cd '${REMOTE_DIR}'
if [ -f '${BASE}.sha256' ]; then sha256sum -c '${BASE}.sha256' || true; fi
tar -xzf '${BASE}'
cd '${BUNDLE_DIR}'
sudo ./deploy.sh --use-npm ${SERVER_ARG}
"

log "远程部署完成"
