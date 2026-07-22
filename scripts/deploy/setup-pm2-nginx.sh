#!/usr/bin/env bash
# setup-pm2-nginx.sh — 仅安装/配置 PM2 + Nginx（自签名 SSL）
#
# 前置（需你方已手工完成）:
#   - Node.js 20+ 与 npm
#   - PostgreSQL（可连接，.env 中 DATABASE_URL 正确）
#   - MinIO（可连接，.env 中 MINIO_* 正确）
#
# 本脚本不做: 安装 Node / PostgreSQL / MinIO
#
# 用法（需 root）:
#   sudo ./setup-pm2-nginx.sh --server-name 192.168.1.10
#   sudo ./setup-pm2-nginx.sh --server-name example.com --app-port 3000 --skip-nginx

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

SERVER_NAME="${SERVER_NAME:-_}"
APP_PORT="${APP_PORT:-3000}"
SKIP_NGINX=false
SKIP_PM2_INSTALL=false

usage() {
  cat <<'EOF'
用法: sudo ./setup-pm2-nginx.sh [选项]

选项:
  --server-name NAME   Nginx server_name / 证书 CN（IP 或域名，推荐填写）
  --app-port PORT      上游 Next.js 端口（默认 3000）
  --skip-nginx         不安装/配置 Nginx
  --skip-pm2-install   不安装 PM2（假定已有）
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --app-port) APP_PORT="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=true; shift ;;
    --skip-pm2-install) SKIP_PM2_INSTALL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  die "请使用 root 运行: sudo $0"
fi

ensure_node_version
require_cmd npm

export DEBIAN_FRONTEND=noninteractive

# ----- PM2 -----
if [[ "$SKIP_PM2_INSTALL" == false ]]; then
  apply_china_registry
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 已安装: $(pm2 -v) ($(command -v pm2))"
  else
    log "安装 PM2（npm i -g pm2）"
    npm install -g pm2
  fi
  require_cmd pm2
  log "PM2 就绪: $(pm2 -v)"
else
  log "跳过 PM2 安装"
fi

# ----- Nginx + 自签名 SSL -----
if [[ "$SKIP_NGINX" == false ]]; then
  if ! command -v nginx >/dev/null 2>&1; then
    log "安装 Nginx"
    apt-get update -y
    apt-get install -y nginx openssl
  else
    require_cmd openssl
    log "Nginx 已安装: $(nginx -v 2>&1 || true)"
  fi

  bash "${SCRIPT_DIR}/setup-nginx-ssl.sh" \
    --server-name "$SERVER_NAME" \
    --app-port "$APP_PORT"
else
  log "跳过 Nginx 配置"
fi

log "PM2 / Nginx 配置完成"
log "  下一步通常由 deploy.sh 完成：导库 + npm ci + build + pm2 start"
