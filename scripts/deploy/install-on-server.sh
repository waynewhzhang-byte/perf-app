#!/usr/bin/env bash
# 在「目标 Ubuntu 服务器」执行：解压部署包、安装依赖（国内镜像）、导入数据库、Prisma 迁移、构建、PM2 启动。
#
# 前置: PostgreSQL、MinIO、Node.js 20+、pm2 已安装；目标机已放置 .env（或使用包内 .env.packaged）
#
# 两种运行模式:
#
#   【推荐】从解压后的 bundle 目录运行 deploy.sh:
#     tar -xzf perf-app-deploy-XXXX.tar.gz
#     cd perf-app-deploy-XXXX
#     sudo ./deploy.sh
#
#   【兼容】直接传 tar.gz 归档路径:
#     sudo ./install-on-server.sh /path/to/perf-app-deploy-XXXX.tar.gz
#
# 常用选项:
#   ./deploy.sh --app-dir /opt/perf-app --use-npm
#   ./deploy.sh --env-file /opt/perf-app/.env --skip-db-import
#   ./deploy.sh --migrate-only   # 空库仅跑迁移，不恢复 dump
#
# 数据库策略（默认）:
#   1. pg_restore 全库 dump（覆盖同名对象）
#   2. prisma migrate deploy（应用代码中尚未在 dump 里的迁移）

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/perf-app}"
ENV_FILE=""
ARCHIVE=""
BUNDLE_DIR=""
SKIP_DB_IMPORT=false
MIGRATE_ONLY=false
SKIP_BUILD=false
SKIP_PM2=false
PM2_APP_NAME="perf-app"
APP_PORT="${APP_PORT:-3000}"
USE_PM="${USE_PM:-}"           # 显式指定包管理器: npm | pnpm，留空则自动检测

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

usage() {
  sed -n '2,18p' "$0"
  echo ""
  echo "选项:"
  echo "  --app-dir PATH        应用安装目录（默认: /opt/perf-app）"
  echo "  --env-file PATH       .env 路径（默认: \$APP_DIR/.env）"
  echo "  --skip-db-import      不导入 database.dump，仅 migrate deploy + 构建"
  echo "  --migrate-only        等同 --skip-db-import（空库或已有库只跑迁移）"
  echo "  --skip-build          跳过项目构建（npm run build / pnpm build）"
  echo "  --skip-pm2            跳过 PM2 重启"
  echo "  --port PORT           Next.js 端口（默认 3000，写入 PM2）"
  echo "  --use-npm             强制使用 npm（npm ci）"
  echo "  --use-pnpm            强制使用 pnpm（pnpm install）"
  echo "  -h, --help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-db-import)
      SKIP_DB_IMPORT=true
      shift
      ;;
    --migrate-only)
      MIGRATE_ONLY=true
      SKIP_DB_IMPORT=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-pm2)
      SKIP_PM2=true
      shift
      ;;
    --port)
      APP_PORT="$2"
      shift 2
      ;;
    --use-npm)
      USE_PM=npm
      export USE_PM
      shift
      ;;
    --use-pnpm)
      USE_PM=pnpm
      export USE_PM
      shift
      ;;
    --bundle-dir)
      BUNDLE_DIR="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      die "未知选项: $1"
      ;;
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

require_cmd psql
require_cmd pg_restore

ensure_node_version

# ---- 确定 BUNDLE_DIR 和 SOURCE_DIR ----
if [[ -n "$BUNDLE_DIR" ]]; then
  # --bundle-dir 模式（由 deploy.sh 调用）
  [[ -d "$BUNDLE_DIR" ]] || die "bundle 目录不存在: $BUNDLE_DIR"
else
  # 尝试自动检测：是否已在解压后的 bundle 目录中运行？
  if [[ -z "$ARCHIVE" ]]; then
    # 检测当前脚本所在目录的层级
    if [[ -f "$SCRIPT_DIR/database.dump" || -d "$SCRIPT_DIR/source" ]]; then
      # 脚本就在 bundle 根目录（如 deploy.sh）
      BUNDLE_DIR="$SCRIPT_DIR"
    elif [[ -f "$SCRIPT_DIR/../../database.dump" || -d "$SCRIPT_DIR/../../source" ]]; then
      # 脚本在 source/scripts/deploy/ 内（直接从 bundle 里运行 install-on-server.sh）
      BUNDLE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
    fi
  fi

  # 若仍未确定 BUNDLE_DIR，则需要从 tar.gz 提取
  if [[ -z "$BUNDLE_DIR" ]]; then
    [[ -n "$ARCHIVE" ]] || {
      echo "用法:" >&2
      echo "  【推荐】解压后运行:  tar -xzf bundle.tar.gz && cd perf-app-deploy-* && sudo ./deploy.sh" >&2
      echo "  【兼容】直接传归档:  $0 /path/to/bundle.tar.gz" >&2
      exit 1
    }
    [[ -f "$ARCHIVE" ]] || die "找不到部署包: $ARCHIVE"

    # 安全检查：拒绝含 ".." 路径的恶意归档（Path Traversal）
    if tar -tzf "$ARCHIVE" 2>/dev/null | grep -qF '..'; then
      die "部署包含非法路径（含 '..'），拒绝解压。请确认压缩包来源可信"
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

# 当 bundle_dir 是临时解压的（archive 模式），注册清理
: "${_CLEANUP_WORK_DIR:=false}"
if [[ "$_CLEANUP_WORK_DIR" == true ]]; then
  cleanup() { rm -rf "$WORK_DIR"; }
  trap cleanup EXIT
fi

if [[ -z "$ARCHIVE" && "$_CLEANUP_WORK_DIR" == false ]]; then
  log "Bundle 目录: ${BUNDLE_DIR}"
fi

# 安全检查：拒绝 bundle 目录与目标目录相同或嵌套
_bundle_real="$(cd "$BUNDLE_DIR" && pwd -P 2>/dev/null || echo "$BUNDLE_DIR")"
_app_real="$(cd "$APP_DIR" 2>/dev/null && pwd -P 2>/dev/null || echo "$APP_DIR")"
if [[ "$_bundle_real" == "$_app_real" ]]; then
  die "Bundle 目录不能与目标目录相同。请将 tar.gz 解压到 /tmp 等临时目录，再运行 deploy.sh"
fi
# 检查 bundle 是否在 app_dir 内部
if [[ "$_app_real" != "/" && "$_bundle_real" == "$_app_real"/* ]]; then
  die "Bundle 目录 ($_bundle_real) 在目标目录 ($_app_real) 内部，会导致递归同步。请解压到外部目录"
fi

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="${APP_DIR}/.env"
fi

mkdir -p "$APP_DIR"
log "同步源代码 -> ${APP_DIR}"
# 排除 bundle 自身目录（防止 BUNDLE_DIR 是 APP_DIR 的祖先时递归同步）
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
  "${SOURCE_DIR}/" "${APP_DIR}/"

if [[ -f "${BUNDLE_DIR}/.env.packaged" ]]; then
  log "使用包内 .env.packaged -> ${ENV_FILE}"
  cp "${BUNDLE_DIR}/.env.packaged" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
elif [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "${BUNDLE_DIR}/.env.example" ]]; then
    cp "${BUNDLE_DIR}/.env.example" "$ENV_FILE"
    log "已从 .env.example 生成 ${ENV_FILE}，请编辑后重新运行本脚本"
    exit 1
  fi
  die "未找到 ${ENV_FILE}，请先创建或打包时使用 --include-env"
fi

load_database_url_from_env "$ENV_FILE"

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
    # pg_restore 对部分非致命错误会返回非 0
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

log "prisma migrate deploy（应用待执行迁移）"
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

if [[ "$SKIP_PM2" == false ]]; then
  require_cmd pm2
  ECOSYSTEM="${SCRIPT_DIR}/ecosystem.config.cjs"
  [[ -f "$ECOSYSTEM" ]] || die "缺少 PM2 配置: $ECOSYSTEM"

  log "PM2 启动/重载 ${PM2_APP_NAME} (port ${APP_PORT})"
  APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" PM2_APP_NAME="$PM2_APP_NAME" \
    pm2 start "$ECOSYSTEM" --update-env 2>/dev/null \
    || APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" PM2_APP_NAME="$PM2_APP_NAME" \
      pm2 reload "$ECOSYSTEM" --update-env

  pm2 save
  log "PM2 状态:"
  pm2 status "$PM2_APP_NAME" || true
else
  log "跳过 PM2（--skip-pm2）。手动启动: cd ${APP_DIR} && npm start"
fi

if [[ "$_CLEANUP_WORK_DIR" == true && -n "${WORK_DIR:-}" ]]; then
  rm -rf "$WORK_DIR"
fi

log "部署完成"
log "  应用目录: ${APP_DIR}"
log "  环境文件: ${ENV_FILE}"
log "  访问: 检查 .env 中 APP_BASE_URL，默认端口 ${APP_PORT}"
