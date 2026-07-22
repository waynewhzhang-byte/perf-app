#!/usr/bin/env bash
# setup-nginx-ssl.sh — 生成自签名证书并配置 Nginx 反向代理到 Next.js
#
# 用法（需 root）:
#   sudo ./setup-nginx-ssl.sh
#   sudo ./setup-nginx-ssl.sh --server-name 10.0.0.8 --app-port 3000
#   sudo ./setup-nginx-ssl.sh --days 3650

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

SERVER_NAME="${SERVER_NAME:-_}"
APP_PORT="${APP_PORT:-3000}"
CERT_DAYS="${CERT_DAYS:-3650}"
SSL_DIR="${SSL_DIR:-/etc/nginx/ssl/perf-app}"
SITE_NAME="perf-app"

usage() {
  cat <<'EOF'
用法: sudo ./setup-nginx-ssl.sh [选项]

选项:
  --server-name NAME   server_name / 证书 CN（IP 或域名，默认 _）
  --app-port PORT      上游 Next.js 端口（默认 3000）
  --days N             证书有效天数（默认 3650）
  --ssl-dir PATH       证书目录（默认 /etc/nginx/ssl/perf-app）
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --app-port) APP_PORT="$2"; shift 2 ;;
    --days) CERT_DAYS="$2"; shift 2 ;;
    --ssl-dir) SSL_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "请使用 root 运行: sudo $0"
fi

require_cmd openssl

if ! command -v nginx >/dev/null 2>&1; then
  log "未检测到 nginx，尝试 apt 安装"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx openssl
fi
require_cmd nginx

mkdir -p "$SSL_DIR"
CERT="${SSL_DIR}/fullchain.pem"
KEY="${SSL_DIR}/privkey.pem"

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  log "生成自签名证书 CN=${SERVER_NAME}（${CERT_DAYS} 天）"
  # SAN 同时覆盖本机与常见访问方式
  SAN="DNS:localhost,IP:127.0.0.1"
  if [[ "$SERVER_NAME" != "_" && "$SERVER_NAME" != "localhost" ]]; then
    if [[ "$SERVER_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      SAN="${SAN},IP:${SERVER_NAME}"
    else
      SAN="${SAN},DNS:${SERVER_NAME}"
    fi
  fi

  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CERT" \
    -days "$CERT_DAYS" \
    -subj "/CN=${SERVER_NAME}" \
    -addext "subjectAltName=${SAN}"
  chmod 600 "$KEY"
  chmod 644 "$CERT"
else
  log "复用已有证书: ${CERT}"
fi

TEMPLATE="${SCRIPT_DIR}/nginx/perf-app.conf.template"
[[ -f "$TEMPLATE" ]] || die "缺少 Nginx 模板: $TEMPLATE"

CONF="/etc/nginx/sites-available/${SITE_NAME}"
sed -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__APP_PORT__|${APP_PORT}|g" \
    -e "s|__SSL_CERT__|${CERT}|g" \
    -e "s|__SSL_KEY__|${KEY}|g" \
    "$TEMPLATE" > "$CONF"

ln -sfn "$CONF" "/etc/nginx/sites-enabled/${SITE_NAME}"
# 去掉默认站点，避免 80 端口冲突
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "Nginx SSL 已配置"
log "  upstream: 127.0.0.1:${APP_PORT}"
log "  cert: ${CERT}"
log "  访问: https://${SERVER_NAME}/ （浏览器将提示自签名证书，选择继续即可）"
log "  请将应用 .env 中 APP_BASE_URL 设为 https://${SERVER_NAME}"
