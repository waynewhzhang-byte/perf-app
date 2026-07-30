#!/usr/bin/env bash
# fix-attachments.sh — 已部署 Ubuntu 上「附件打不开 / ERR_SSL_PROTOCOL_ERROR」一键修复
#
# 典型根因:
#   MINIO_PUBLIC_ENDPOINT=公网IP 且 MINIO_PUBLIC_USE_SSL=true，但端口仍是裸 MinIO 9000（只讲 HTTP）
#   浏览器访问 https://IP:9000/... → ERR_SSL_PROTOCOL_ERROR → 图片/PDF 裂开
#
# 默认修复: 改回「应用代理」模式（注释 MINIO_PUBLIC_*），无需再开 MinIO 公网端口。
#
# 用法（在目标机）:
#   sudo /opt/perf-app/scripts/deploy/fix-attachments.sh --server-name 1.92.206.86
#   # 或从部署包:
#   sudo ./bootstrap/fix-attachments.sh --server-name 1.92.206.86
#   # 若坚持浏览器直连 MinIO（需 Nginx 8443 反代）:
#   sudo ./bootstrap/fix-attachments.sh --server-name 1.92.206.86 \
#     --attachment-mode minio-https --setup-minio-nginx

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${ENV_FILE:-/opt/perf-app/.env}"
SERVER_NAME=""
ATTACHMENT_MODE="proxy"
EXTRA_ARGS=()

usage() {
  cat <<'EOF'
用法: sudo ./fix-attachments.sh --server-name <公网IP或域名> [选项]

选项:
  --env-file PATH
  --server-name NAME           必填
  --attachment-mode MODE       proxy（默认）| minio-https
  --setup-minio-nginx          仅 minio-https：顺带配置 Nginx:8443 → MinIO:9000
  --minio-public-port PORT     默认 8443
  --dry-run
  -h, --help

修复后请硬刷新浏览器再试打开附件。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; EXTRA_ARGS+=(--env-file "$2"); shift 2 ;;
    --server-name) SERVER_NAME="$2"; EXTRA_ARGS+=(--server-name "$2"); shift 2 ;;
    --attachment-mode) ATTACHMENT_MODE="$2"; EXTRA_ARGS+=(--attachment-mode "$2"); shift 2 ;;
    --setup-minio-nginx) EXTRA_ARGS+=(--setup-minio-nginx); shift ;;
    --minio-public-port) EXTRA_ARGS+=(--minio-public-port "$2"); shift 2 ;;
    --dry-run) EXTRA_ARGS+=(--dry-run); shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

[[ -n "$SERVER_NAME" ]] || die "请指定 --server-name"

log "===== 附件访问修复（模式=${ATTACHMENT_MODE}）====="
if [[ ! -f "$ENV_FILE" ]]; then
  die "找不到 ${ENV_FILE}"
fi

# 打印当前可疑配置
log "当前 MinIO / APP 相关配置:"
grep -E '^(# )?MINIO_|^APP_BASE_URL=' "$ENV_FILE" 2>/dev/null | sed 's/^/  /' || true

bash "${SCRIPT_DIR}/configure-env.sh" "${EXTRA_ARGS[@]}"

# 本机 MinIO 探活
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://127.0.0.1:9000/minio/health/live || true)"
  if [[ "$code" == "200" ]]; then
    log "本机 MinIO 探活 OK (HTTP ${code})"
  else
    log "警告: 本机 MinIO 探活失败 (HTTP ${code:-none}) — 请确认 minio 服务已启动且监听 127.0.0.1:9000"
  fi
fi

log "===== 修复完成 ====="
log "验证步骤:"
log "  1. sudo -u \"\${SUDO_USER:-$USER}\" -i pm2 status   # 确认 online，且不是 root 空列表"
log "  2. grep MINIO_PUBLIC ${ENV_FILE}   # 代理模式应为注释行 # MINIO_PUBLIC_*"
log "  3. 浏览器硬刷新后打开附件；Network 里 /view 的 JSON 中 viewUrl 应为 .../view?proxy=1"
log "  4. 若 viewUrl 仍含 :9000，说明进程未吃到新 .env — 执行:"
log "       sudo -u <部署用户> -i pm2 delete perf-app"
log "       cd /opt/perf-app && sudo -u <部署用户> -i pm2 start /opt/perf-app/scripts/deploy/ecosystem.config.cjs"
log "  5. 若仍裂图：本迁移默认不迁 MinIO 对象，需确认桶内确有该文件"
