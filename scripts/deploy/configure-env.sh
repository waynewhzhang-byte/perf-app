#!/usr/bin/env bash
# configure-env.sh — 按目标机写入/修正 /opt/perf-app/.env（附件可打开）
#
# 两种附件访问模式（二选一）:
#
#   proxy（默认，推荐）:
#     不设置 MINIO_PUBLIC_* → 浏览器经 Next.js /api/attachments/.../view?proxy=1
#     与站点同域 HTTPS，无需对外暴露 MinIO 9000，也不会出现 ERR_SSL_PROTOCOL_ERROR
#
#   minio-https:
#     Nginx 在 8443 终结 TLS → 反代本机 MinIO :9000
#     设置 MINIO_PUBLIC_ENDPOINT/PORT/USE_SSL=true（端口必须是 HTTPS 反代口，绝不能是裸 9000）
#
# 用法:
#   sudo ./configure-env.sh --server-name 1.92.206.86
#   sudo ./configure-env.sh --server-name 1.92.206.86 --attachment-mode proxy
#   sudo ./configure-env.sh --server-name 1.92.206.86 --attachment-mode minio-https --minio-public-port 8443
#   sudo ./configure-env.sh --env-file /opt/perf-app/.env --server-name 1.92.206.86 --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${ENV_FILE:-/opt/perf-app/.env}"
SERVER_NAME="${SERVER_NAME:-_}"
ATTACHMENT_MODE="${ATTACHMENT_MODE:-proxy}"
MINIO_PUBLIC_PORT="${MINIO_PUBLIC_PORT:-8443}"
MINIO_UPSTREAM="${MINIO_UPSTREAM:-127.0.0.1:9000}"
SETUP_MINIO_NGINX=false
DRY_RUN=false
RESTART_PM2=true

usage() {
  cat <<'EOF'
用法: sudo ./configure-env.sh [选项]

选项:
  --env-file PATH              .env 路径（默认 /opt/perf-app/.env）
  --server-name NAME           公网 IP 或域名（写入 APP_BASE_URL / MINIO_PUBLIC）
  --attachment-mode MODE       proxy（默认）| minio-https
  --minio-public-port PORT     minio-https 对外端口（默认 8443）
  --minio-upstream HOST:PORT    本机 MinIO（默认 127.0.0.1:9000）
  --setup-minio-nginx          minio-https 时一并执行 setup-minio-nginx-ssl.sh
  --no-restart                 不自动 pm2 restart
  --dry-run                    只打印将写入的内容，不改文件
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --attachment-mode) ATTACHMENT_MODE="$2"; shift 2 ;;
    --minio-public-port) MINIO_PUBLIC_PORT="$2"; shift 2 ;;
    --minio-upstream) MINIO_UPSTREAM="$2"; shift 2 ;;
    --setup-minio-nginx) SETUP_MINIO_NGINX=true; shift ;;
    --no-restart) RESTART_PM2=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

case "$ATTACHMENT_MODE" in
  proxy|minio-https) ;;
  *) die "--attachment-mode 只能是 proxy 或 minio-https" ;;
esac

if [[ "$SERVER_NAME" == "_" || -z "$SERVER_NAME" ]]; then
  die "请指定 --server-name <公网IP或域名>"
fi

[[ -f "$ENV_FILE" ]] || die "找不到 .env: $ENV_FILE（请先部署或从 env.ubuntu.example 复制）"

# 在 .env 中设置或替换 KEY=VALUE；若原行为注释则取消注释
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null; then
    # 保留文件其余行，只改匹配键（含曾被注释的）
    awk -v k="$key" -v v="$value" '
      BEGIN { done=0 }
      {
        if ($0 ~ "^[[:space:]]*#?[[:space:]]*" k "=") {
          if (!done) { print k "=" v; done=1 }
          next
        }
        print
      }
      END { if (!done) print k "=" v }
    ' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '\n%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

# 注释掉 KEY（保留原值便于回滚）
env_comment() {
  local key="$1" tmp
  tmp="$(mktemp)"
  awk -v k="$key" '
    {
      if ($0 ~ "^[[:space:]]*" k "=") {
        print "# " $0 "  # disabled by configure-env.sh"
        next
      }
      print
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# 检测危险配置：对裸 9000 开 HTTPS（典型 ERR_SSL_PROTOCOL_ERROR）
warn_bad_public_ssl() {
  local pub_ep pub_port pub_ssl
  pub_ep="$(env_get "$ENV_FILE" MINIO_PUBLIC_ENDPOINT)"
  pub_port="$(env_get "$ENV_FILE" MINIO_PUBLIC_PORT)"
  pub_ssl="$(env_get "$ENV_FILE" MINIO_PUBLIC_USE_SSL)"
  pub_port="${pub_port:-9000}"
  if [[ -n "$pub_ep" && "$pub_ssl" == "true" && "$pub_port" == "9000" ]]; then
    log "警告: 检测到 MINIO_PUBLIC_USE_SSL=true 且端口=9000"
    log "  这通常会导致浏览器 ERR_SSL_PROTOCOL_ERROR（MinIO API 默认是 HTTP）"
  fi
}

log "修正前检查:"
warn_bad_public_ssl || true
log "  模式: ${ATTACHMENT_MODE}"
log "  文件: ${ENV_FILE}"
log "  SERVER_NAME: ${SERVER_NAME}"

if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] 将设置:"
  log "  APP_BASE_URL=https://${SERVER_NAME}"
  log "  MINIO_ENDPOINT=127.0.0.1"
  log "  MINIO_PORT=9000"
  log "  MINIO_USE_SSL=false"
  if [[ "$ATTACHMENT_MODE" == "proxy" ]]; then
    log "  # 注释掉 MINIO_PUBLIC_* （走应用代理）"
  else
    log "  MINIO_PUBLIC_ENDPOINT=${SERVER_NAME}"
    log "  MINIO_PUBLIC_PORT=${MINIO_PUBLIC_PORT}"
    log "  MINIO_PUBLIC_USE_SSL=true"
  fi
  exit 0
fi

# 备份
cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
chmod 600 "$ENV_FILE"

# 同机 MinIO：SDK 永远走本机 HTTP
env_set MINIO_ENDPOINT "127.0.0.1"
env_set MINIO_PORT "9000"
env_set MINIO_USE_SSL "false"

# 应用对外地址（Cookie Secure 依赖 https）
env_set APP_BASE_URL "https://${SERVER_NAME}"

if [[ "$ATTACHMENT_MODE" == "proxy" ]]; then
  env_comment MINIO_PUBLIC_ENDPOINT
  env_comment MINIO_PUBLIC_PORT
  env_comment MINIO_PUBLIC_USE_SSL
  log "已启用附件代理模式：浏览器经 /api/attachments/.../view?proxy=1 访问"
else
  env_set MINIO_PUBLIC_ENDPOINT "$SERVER_NAME"
  env_set MINIO_PUBLIC_PORT "$MINIO_PUBLIC_PORT"
  env_set MINIO_PUBLIC_USE_SSL "true"
  log "已启用 MinIO HTTPS 预签名模式: https://${SERVER_NAME}:${MINIO_PUBLIC_PORT}/"

  if [[ "$SETUP_MINIO_NGINX" == true ]]; then
    MINIO_SSL_SCRIPT="${SCRIPT_DIR}/setup-minio-nginx-ssl.sh"
    [[ -f "$MINIO_SSL_SCRIPT" ]] || die "缺少 $MINIO_SSL_SCRIPT"
    bash "$MINIO_SSL_SCRIPT" \
      --server-name "$SERVER_NAME" \
      --public-port "$MINIO_PUBLIC_PORT" \
      --upstream "$MINIO_UPSTREAM"
  else
    log "提示: 请确认 Nginx 已在 ${MINIO_PUBLIC_PORT} 做 HTTPS→MinIO 反代"
    log "  可执行: sudo ${SCRIPT_DIR}/setup-minio-nginx-ssl.sh --server-name ${SERVER_NAME} --public-port ${MINIO_PUBLIC_PORT}"
  fi
fi

log "修正后关键项:"
grep -E '^(# )?MINIO_|^APP_BASE_URL=' "$ENV_FILE" | sed 's/^/  /' || true

if [[ "$RESTART_PM2" == true ]]; then
  # sudo 时必须用原登录用户的 pm2；root 的 pm2 列表通常是空的，restart 会静默失败 → 「修了没效果」
  restart_perf_app_pm2
fi

log "完成。请用审核账号打开附件验证（硬刷新 Ctrl+Shift+R）。"
log "若仍失败，在服务器执行:"
log "  grep -E '^(# )?MINIO_|^APP_BASE_URL=' ${ENV_FILE}"
log "  curl -sI http://127.0.0.1:9000/minio/health/live"
log "  curl -k -sI https://${SERVER_NAME}/"
log "  # 用审核员已登录浏览器的 Cookie，看 viewUrl 是否含 proxy=1 或仍指向 :9000"
if [[ "$ATTACHMENT_MODE" == "minio-https" ]]; then
  log "  curl -k -sI https://${SERVER_NAME}:${MINIO_PUBLIC_PORT}/minio/health/live"
fi
