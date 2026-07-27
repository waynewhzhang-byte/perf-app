#!/usr/bin/env bash
# 在「目标 Ubuntu」一键部署应用（假定 Node/npm、PostgreSQL、MinIO 已手工装好）:
#   同步源码 → 导入 database.dump → prisma migrate → npm ci/build
#   → 安装/配置 PM2 → 安装/配置 Nginx 自签名 SSL → 启动应用
#
# 前置（手工完成）:
#   - Node.js 20+ 与 npm
#   - PostgreSQL 可连（.env DATABASE_URL）
#   - MinIO 可连（.env MINIO_*）；不迁移对象数据
#   - 客户端工具: psql、pg_restore、rsync
#
# 【推荐】解压包后:
#   sudo ./deploy.sh --server-name 192.168.1.10
#
# 【兼容】:
#   sudo ./install-on-server.sh /path/to/bundle.tar.gz --server-name 192.168.1.10

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/perf-app}"
ENV_FILE=""
ARCHIVE=""
BUNDLE_DIR=""
SKIP_DB_IMPORT=false
MIGRATE_ONLY=false
SKIP_BUILD=false
SKIP_PM2=false
SKIP_NGINX=false
SERVER_NAME="${SERVER_NAME:-_}"
PM2_APP_NAME="perf-app"
APP_PORT="${APP_PORT:-3000}"
PM2_INSTANCES="${PM2_INSTANCES:-max}"
USE_PM="${USE_PM:-npm}"
ATTACHMENT_MODE="${ATTACHMENT_MODE:-proxy}"
MINIO_PUBLIC_PORT="${MINIO_PUBLIC_PORT:-8443}"
SETUP_MINIO_NGINX=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

usage() {
  cat <<'EOF'
用法: sudo ./deploy.sh [选项]
      sudo ./install-on-server.sh [--bundle-dir DIR | ARCHIVE.tar.gz] [选项]

前置: 已手工安装 Node/npm、PostgreSQL、MinIO。
本脚本负责: 导库 + 构建 + 安装配置 PM2 + Nginx SSL。

选项:
  --app-dir PATH        应用安装目录（默认: /opt/perf-app）
  --env-file PATH       .env 路径（默认: $APP_DIR/.env）
  --server-name NAME    Nginx/证书名（IP 或域名，推荐）
  --port PORT           Next.js 端口（默认 3000）
  --instances N|max     PM2 集群实例数（默认 max）
  --attachment-mode M   proxy（默认，推荐）| minio-https
  --minio-public-port N minio-https 对外端口（默认 8443）
  --setup-minio-nginx   minio-https 时配置 Nginx→MinIO 反代
  --skip-db-import      不导入 database.dump
  --migrate-only        等同 --skip-db-import
  --skip-build          跳过 npm run build
  --skip-pm2            不安装/不启动 PM2
  --skip-nginx          不安装/不配置 Nginx
  --use-npm             使用 npm（默认）
  --use-pnpm            使用 pnpm
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --skip-db-import) SKIP_DB_IMPORT=true; shift ;;
    --migrate-only) MIGRATE_ONLY=true; SKIP_DB_IMPORT=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-pm2) SKIP_PM2=true; shift ;;
    --skip-nginx) SKIP_NGINX=true; shift ;;
    --attachment-mode) ATTACHMENT_MODE="$2"; shift 2 ;;
    --minio-public-port) MINIO_PUBLIC_PORT="$2"; shift 2 ;;
    --setup-minio-nginx) SETUP_MINIO_NGINX=true; shift ;;
    --port) APP_PORT="$2"; shift 2 ;;
    --instances) PM2_INSTANCES="$2"; shift 2 ;;
    --use-npm) USE_PM=npm; export USE_PM; shift ;;
    --use-pnpm) USE_PM=pnpm; export USE_PM; shift ;;
    --bundle-dir) BUNDLE_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "未知选项: $1" ;;
    *)
      if [[ -z "$ARCHIVE" ]]; then
        ARCHIVE="$1"
      else
        die "多余的参数: $1"
      fi
      shift
      ;;
  esac
done

export USE_PM
export PM2_INSTANCES

# ----- 前置检查（不安装 Node/PG/MinIO）-----
log "前置检查：Node / npm / PostgreSQL 客户端（环境需已手工安装）"
ensure_node_version
require_cmd npm
require_cmd psql
require_cmd pg_restore
require_cmd rsync

# ---- 确定 BUNDLE_DIR 和 SOURCE_DIR ----
if [[ -n "$BUNDLE_DIR" ]]; then
  [[ -d "$BUNDLE_DIR" ]] || die "bundle 目录不存在: $BUNDLE_DIR"
else
  if [[ -z "$ARCHIVE" ]]; then
    if [[ -f "$SCRIPT_DIR/database.dump" || -d "$SCRIPT_DIR/source" ]]; then
      BUNDLE_DIR="$SCRIPT_DIR"
    elif [[ -f "$SCRIPT_DIR/../../database.dump" || -d "$SCRIPT_DIR/../../source" ]]; then
      BUNDLE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
    fi
  fi

  if [[ -z "$BUNDLE_DIR" ]]; then
    [[ -n "$ARCHIVE" ]] || {
      echo "用法: tar -xzf bundle.tar.gz && cd perf-app-deploy-* && sudo ./deploy.sh --server-name <IP>" >&2
      exit 1
    }
    [[ -f "$ARCHIVE" ]] || die "找不到部署包: $ARCHIVE"
    if tar -tzf "$ARCHIVE" 2>/dev/null | grep -qF '..'; then
      die "部署包含非法路径（含 '..'），拒绝解压"
    fi
    WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/perf-app-install.XXXXXX")"
    log "解压 ${ARCHIVE} -> ${WORK_DIR}"
    tar -xzf "$ARCHIVE" -C "$WORK_DIR"
    BUNDLE_DIR="$(find "$WORK_DIR" -maxdepth 1 -type d -name 'perf-app-deploy-*' | head -n1)"
    [[ -n "$BUNDLE_DIR" ]] || die "压缩包内未找到 perf-app-deploy-* 目录"
    _CLEANUP_WORK_DIR=true
  else
    _CLEANUP_WORK_DIR=false
  fi
fi

SOURCE_DIR="${BUNDLE_DIR}/source"
[[ -d "$SOURCE_DIR" ]] || die "bundle 内缺少 source/ 目录: $BUNDLE_DIR"

: "${_CLEANUP_WORK_DIR:=false}"
if [[ "$_CLEANUP_WORK_DIR" == true ]]; then
  cleanup() { rm -rf "$WORK_DIR"; }
  trap cleanup EXIT
fi

if [[ -z "$ARCHIVE" && "$_CLEANUP_WORK_DIR" == false ]]; then
  log "Bundle 目录: ${BUNDLE_DIR}"
fi

_bundle_real="$(cd "$BUNDLE_DIR" && pwd -P 2>/dev/null || echo "$BUNDLE_DIR")"
_app_real="$(cd "$APP_DIR" 2>/dev/null && pwd -P 2>/dev/null || echo "$APP_DIR")"
if [[ "$_bundle_real" == "$_app_real" ]]; then
  die "Bundle 目录不能与目标目录相同。请解压到 /tmp 等临时目录再运行 deploy.sh"
fi
if [[ "$_app_real" != "/" && "$_bundle_real" == "$_app_real"/* ]]; then
  die "Bundle 目录在目标目录内部，会导致递归同步"
fi

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="${APP_DIR}/.env"
fi

mkdir -p "$APP_DIR"
log "同步源代码 -> ${APP_DIR}"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude '/source' \
  --exclude '/deploy.sh' \
  --exclude '/database.dump' \
  --exclude '/MANIFEST.txt' \
  --exclude '/.env.example' \
  --exclude '/.env.packaged' \
  --exclude '/bootstrap' \
  --exclude '/bootstrap.sh' \
  "${SOURCE_DIR}/" "${APP_DIR}/"

if [[ -f "${BUNDLE_DIR}/.env.packaged" ]]; then
  log "使用包内 .env.packaged -> ${ENV_FILE}"
  cp "${BUNDLE_DIR}/.env.packaged" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
elif [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "${BUNDLE_DIR}/env.ubuntu.example" ]]; then
    cp "${BUNDLE_DIR}/env.ubuntu.example" "$ENV_FILE"
    log "已从 env.ubuntu.example 生成 ${ENV_FILE}，请按目标机 PG/MinIO 地址编辑后重新运行"
    exit 1
  fi
  if [[ -f "${BUNDLE_DIR}/.env.example" ]]; then
    cp "${BUNDLE_DIR}/.env.example" "$ENV_FILE"
    log "已从 .env.example 生成 ${ENV_FILE}，请编辑后重新运行本脚本"
    exit 1
  fi
  die "未找到 ${ENV_FILE}，请先创建或打包时使用 --include-env"
fi

# 按 SERVER_NAME 修正 APP_BASE_URL / MinIO 附件访问（避免 ERR_SSL_PROTOCOL_ERROR）
if [[ "$SERVER_NAME" != "_" && "$SERVER_NAME" != "localhost" ]]; then
  CONFIGURE_ENV="${SCRIPT_DIR}/configure-env.sh"
  if [[ ! -f "$CONFIGURE_ENV" && -f "${BUNDLE_DIR}/bootstrap/configure-env.sh" ]]; then
    CONFIGURE_ENV="${BUNDLE_DIR}/bootstrap/configure-env.sh"
  fi
  if [[ -f "$CONFIGURE_ENV" ]]; then
    log "配置附件访问模式: ${ATTACHMENT_MODE}"
    CFG_ARGS=(
      --env-file "$ENV_FILE"
      --server-name "$SERVER_NAME"
      --attachment-mode "$ATTACHMENT_MODE"
      --minio-public-port "$MINIO_PUBLIC_PORT"
      --no-restart
    )
    if [[ "$ATTACHMENT_MODE" == "minio-https" && "$SETUP_MINIO_NGINX" == true ]]; then
      CFG_ARGS+=(--setup-minio-nginx)
    fi
    bash "$CONFIGURE_ENV" "${CFG_ARGS[@]}"
  else
    log "警告: 未找到 configure-env.sh，请手动检查 MINIO_PUBLIC_* / APP_BASE_URL"
  fi
else
  log "提示: 未指定 --server-name，跳过自动修正 APP_BASE_URL / 附件模式"
  log "  若附件打不开（ERR_SSL_PROTOCOL_ERROR），请运行:"
  log "  sudo ${SCRIPT_DIR}/fix-attachments.sh --server-name <公网IP>"
fi

load_database_url_from_env "$ENV_FILE"

# 探测数据库连通
log "探测 PostgreSQL ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null \
  || die "无法连接 PostgreSQL。请确认已手工安装且 .env 中 DATABASE_URL 正确"

import_database() {
  local dump="${BUNDLE_DIR}/database.dump"
  [[ -f "$dump" ]] || die "包内无 database.dump，请使用 --migrate-only 或重新打包"

  log "确保数据库 ${PGDATABASE} 存在"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
    -tc "SELECT 1 FROM pg_database WHERE datname = '${PGDATABASE}'" | grep -q 1 \
    || psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"${PGDATABASE}\""

  log "pg_restore（--clean --if-exists）-> ${PGDATABASE}"
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --clean --if-exists --no-owner --no-acl \
    "$dump" || {
    log "pg_restore 返回非零（常见为「对象不存在」类警告），继续执行 migrate"
  }
}

cd "$APP_DIR"
ensure_package_manager "$APP_DIR"
install_dependencies "$APP_DIR"

if [[ "$SKIP_DB_IMPORT" == false ]]; then
  import_database
else
  log "跳过数据库 dump 导入（--skip-db-import / --migrate-only）"
fi

log "prisma generate"
run_prisma generate "$APP_DIR"

log "prisma migrate deploy"
run_prisma "migrate deploy" "$APP_DIR"

if [[ "$SKIP_BUILD" == false ]]; then
  log "构建项目"
  _pm="$(detect_package_manager "$APP_DIR")"
  case "$_pm" in
    npm) npm run build ;;
    pnpm) pnpm build ;;
  esac
else
  log "跳过构建（--skip-build）"
fi

# ----- 安装/配置 PM2 + Nginx（不装 Node/PG/MinIO）-----
SETUP_SCRIPT="${SCRIPT_DIR}/setup-pm2-nginx.sh"
# bundle 根目录运行时 SCRIPT_DIR 可能是 source/scripts/deploy
if [[ ! -f "$SETUP_SCRIPT" && -f "${BUNDLE_DIR}/bootstrap/setup-pm2-nginx.sh" ]]; then
  SETUP_SCRIPT="${BUNDLE_DIR}/bootstrap/setup-pm2-nginx.sh"
fi
if [[ ! -f "$SETUP_SCRIPT" && -f "${BUNDLE_DIR}/source/scripts/deploy/setup-pm2-nginx.sh" ]]; then
  SETUP_SCRIPT="${BUNDLE_DIR}/source/scripts/deploy/setup-pm2-nginx.sh"
fi

SETUP_ARGS=(--server-name "$SERVER_NAME" --app-port "$APP_PORT")
[[ "$SKIP_NGINX" == true ]] && SETUP_ARGS+=(--skip-nginx)
[[ "$SKIP_PM2" == true ]] && SETUP_ARGS+=(--skip-pm2-install)

if [[ "$SKIP_PM2" == true && "$SKIP_NGINX" == true ]]; then
  log "跳过 PM2 / Nginx 安装配置"
elif [[ -f "$SETUP_SCRIPT" ]]; then
  log "配置 PM2 / Nginx"
  if [[ "$(id -u)" -eq 0 ]]; then
    bash "$SETUP_SCRIPT" "${SETUP_ARGS[@]}"
  else
    sudo bash "$SETUP_SCRIPT" "${SETUP_ARGS[@]}"
  fi
else
  log "警告: 未找到 setup-pm2-nginx.sh，请手动安装 pm2 并配置 nginx"
fi

if [[ "$SKIP_PM2" == false ]]; then
  require_cmd pm2
  ECOSYSTEM="${SCRIPT_DIR}/ecosystem.config.cjs"
  if [[ ! -f "$ECOSYSTEM" ]]; then
    ECOSYSTEM="${APP_DIR}/scripts/deploy/ecosystem.config.cjs"
  fi
  [[ -f "$ECOSYSTEM" ]] || die "缺少 PM2 配置: ecosystem.config.cjs"

  log "PM2 启动 ${PM2_APP_NAME} (port ${APP_PORT}, instances=${PM2_INSTANCES})"
  pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
  APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" PM2_APP_NAME="$PM2_APP_NAME" PM2_INSTANCES="$PM2_INSTANCES" \
    pm2 start "$ECOSYSTEM" --update-env
  pm2 save
  RUN_USER="${SUDO_USER:-$USER}"
  RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6 || echo "/home/${RUN_USER}")"
  pm2 startup systemd -u "$RUN_USER" --hp "$RUN_HOME" >/dev/null 2>&1 || true
  log "PM2 状态:"
  pm2 status "$PM2_APP_NAME" || true
else
  log "跳过 PM2 启动。手动: cd ${APP_DIR} && npm start"
fi

if [[ "$_CLEANUP_WORK_DIR" == true && -n "${WORK_DIR:-}" ]]; then
  rm -rf "$WORK_DIR"
fi

log "部署完成"
log "  应用目录: ${APP_DIR}"
log "  环境文件: ${ENV_FILE}"
log "  附件模式: ${ATTACHMENT_MODE}"
log "  PM2 实例: ${PM2_INSTANCES}"
log "  本机: http://127.0.0.1:${APP_PORT}/"
if [[ "$SKIP_NGINX" == false ]]; then
  log "  HTTPS: https://${SERVER_NAME}/ （自签名证书需浏览器确认）"
fi
if [[ "$ATTACHMENT_MODE" == "proxy" ]]; then
  log "  附件: 经应用代理 /api/attachments/.../view?proxy=1（勿对 MinIO:9000 开 HTTPS）"
else
  log "  附件: MinIO HTTPS 预签名 https://${SERVER_NAME}:${MINIO_PUBLIC_PORT}/"
fi
log "  若附件仍打不开: sudo ${SCRIPT_DIR}/fix-attachments.sh --server-name ${SERVER_NAME}"
log "  说明: 未安装 Node/PG/MinIO；未迁移 MinIO 对象"
