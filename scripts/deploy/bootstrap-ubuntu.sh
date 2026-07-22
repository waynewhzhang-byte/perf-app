#!/usr/bin/env bash
# bootstrap-ubuntu.sh — 兼容入口，等同 setup-pm2-nginx.sh
#
# 注意: 不再安装 Node / PostgreSQL / MinIO（请手工准备）。
# 仅安装并配置 PM2 + Nginx 自签名 SSL。

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/setup-pm2-nginx.sh" "$@"
