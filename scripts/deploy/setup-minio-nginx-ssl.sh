#!/usr/bin/env bash
# setup-minio-nginx-ssl.sh — 为 MinIO 增加 HTTPS 反代（默认 :8443 → 127.0.0.1:9000）
#
# 前置:
#   - MinIO 已在本机 HTTP 运行（默认 127.0.0.1:9000）
#   - 已有 Nginx；建议已跑过 setup-nginx-ssl.sh（可复用同一自签名证书）
#
# 用法:
#   sudo ./setup-minio-nginx-ssl.sh --server-name 1.92.206.86
#   sudo ./setup-minio-nginx-ssl.sh --server-name 1.92.206.86 --public-port 8443
#
# 配置完成后，在 /opt/perf-app/.env 中设置:
#   MINIO_ENDPOINT=127.0.0.1
#   MINIO_PORT=9000
#   MINIO_USE_SSL=false
#   MINIO_PUBLIC_ENDPOINT=1.92.206.86
#   MINIO_PUBLIC_PORT=8443
#   MINIO_PUBLIC_USE_SSL=true
#   然后: pm2 restart perf-app
# 并放行防火墙/安全组 TCP 8443

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

SERVER_NAME="${SERVER_NAME:-_}"
PUBLIC_PORT="${PUBLIC_PORT:-8443}"
MINIO_UPSTREAM="${MINIO_UPSTREAM:-127.0.0.1:9000}"
SSL_DIR="${SSL_DIR:-/etc/nginx/ssl/perf-app}"
SITE_NAME="perf-minio"

usage() {
  cat <<'EOF'
用法: sudo ./setup-minio-nginx-ssl.sh [选项]

选项:
  --server-name NAME     证书/站点名（IP 或域名，如 1.92.206.86）
  --public-port PORT     对外 HTTPS 端口（默认 8443，避免与站点 443 冲突）
  --upstream HOST:PORT   本机 MinIO（默认 127.0.0.1:9000）
  --ssl-dir PATH         证书目录（默认 /etc/nginx/ssl/perf-app，与主站共用）
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --public-port) PUBLIC_PORT="$2"; shift 2 ;;
    --upstream) MINIO_UPSTREAM="$2"; shift 2 ;;
    --ssl-dir) SSL_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "请使用 root 运行: sudo $0"
fi

require_cmd nginx
require_cmd openssl

if ! command -v nginx >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx openssl
fi

mkdir -p "$SSL_DIR"
CERT="${SSL_DIR}/fullchain.pem"
KEY="${SSL_DIR}/privkey.pem"

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  log "未找到主站证书，生成自签名证书 CN=${SERVER_NAME}"
  SAN="DNS:localhost,IP:127.0.0.1"
  if [[ "$SERVER_NAME" != "_" && "$SERVER_NAME" != "localhost" ]]; then
    if [[ "$SERVER_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      SAN="${SAN},IP:${SERVER_NAME}"
    else
      SAN="${SAN},DNS:${SERVER_NAME}"
    fi
  fi
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY" -out "$CERT" -days 3650 \
    -subj "/CN=${SERVER_NAME}" \
    -addext "subjectAltName=${SAN}"
  chmod 600 "$KEY"
  chmod 644 "$CERT"
else
  log "复用证书: ${CERT}"
fi

TEMPLATE="${SCRIPT_DIR}/nginx/minio-https.conf.template"
[[ -f "$TEMPLATE" ]] || die "缺少模板: $TEMPLATE"

CONF="/etc/nginx/sites-available/${SITE_NAME}"
sed -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__MINIO_PUBLIC_PORT__|${PUBLIC_PORT}|g" \
    -e "s|__SSL_CERT__|${CERT}|g" \
    -e "s|__SSL_KEY__|${KEY}|g" \
    -e "s|__MINIO_UPSTREAM__|${MINIO_UPSTREAM}|g" \
    "$TEMPLATE" > "$CONF"

ln -sfn "$CONF" "/etc/nginx/sites-enabled/${SITE_NAME}"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "MinIO HTTPS 反代已配置"
log "  对外: https://${SERVER_NAME}:${PUBLIC_PORT}/"
log "  上游: http://${MINIO_UPSTREAM}"
log ""
log "请更新 /opt/perf-app/.env:"
log "  MINIO_ENDPOINT=127.0.0.1"
log "  MINIO_PORT=9000"
log "  MINIO_USE_SSL=false"
log "  MINIO_PUBLIC_ENDPOINT=${SERVER_NAME}"
log "  MINIO_PUBLIC_PORT=${PUBLIC_PORT}"
log "  MINIO_PUBLIC_USE_SSL=true"
log "然后: pm2 restart perf-app"
log "并放行安全组/防火墙 TCP ${PUBLIC_PORT}"
