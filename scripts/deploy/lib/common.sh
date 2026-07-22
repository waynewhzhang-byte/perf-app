#!/usr/bin/env bash
# 部署脚本公共函数（pack / install / bootstrap 共用）

set -euo pipefail

log() {
  echo "[$(date +%H:%M:%S)] $*"
}

die() {
  echo "错误: $*" >&2
  exit 1
}

require_cmd() {
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "缺少命令: $c"
  done
}

# 从 .env 读取 KEY=VALUE（去掉引号）
env_get() {
  local env_file="$1" key="$2" line val
  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" 2>/dev/null | tail -n1 || true)"
  [[ -n "$line" ]] || { echo ""; return 0; }
  val="${line#*=}"
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  echo "$val"
}

# 从 .env 读取 DATABASE_URL（简单解析，支持常见 postgresql URL）
load_database_url_from_env() {
  local env_file="$1"
  [[ -f "$env_file" ]] || die "环境文件不存在: $env_file"

  local url
  url="$(env_get "$env_file" DATABASE_URL)"
  [[ -n "$url" ]] || die "$env_file 中未找到 DATABASE_URL"

  parse_postgres_url "$url"
}

parse_postgres_url() {
  local url="$1"
  if [[ ! "$url" =~ ^postgres(ql)?:// ]]; then
    die "无法解析 DATABASE_URL（需 postgresql:// 格式）"
  fi

  # postgresql://user:pass@host:port/db?schema=public
  local rest="${url#*://}"
  local userpass="${rest%%@*}"
  local hostpart="${rest#*@}"
  local hostport="${hostpart%%/*}"
  local dbquery="${hostpart#*/}"
  PGDATABASE="${dbquery%%\?*}"

  PGUSER="${userpass%%:*}"
  local pass="${userpass#*:}"
  if [[ "$pass" == "$userpass" ]]; then
    PGPASSWORD=""
  else
    PGPASSWORD="$pass"
  fi
  export PGPASSWORD

  if [[ "$hostport" == *:* ]]; then
    PGHOST="${hostport%%:*}"
    PGPORT="${hostport#*:}"
  else
    PGHOST="$hostport"
    PGPORT="5432"
  fi

  export PGHOST PGPORT PGUSER PGDATABASE
  PGDUMP_OPTS=(-h "$PGHOST" -p "$PGPORT" -U "$PGUSER")
}

# 从 .env 读取 MinIO 连接信息
load_minio_from_env() {
  local env_file="$1"
  [[ -f "$env_file" ]] || die "环境文件不存在: $env_file"

  MINIO_ENDPOINT="$(env_get "$env_file" MINIO_ENDPOINT)"
  MINIO_PORT="$(env_get "$env_file" MINIO_PORT)"
  MINIO_USE_SSL="$(env_get "$env_file" MINIO_USE_SSL)"
  MINIO_ACCESS_KEY="$(env_get "$env_file" MINIO_ACCESS_KEY)"
  MINIO_SECRET_KEY="$(env_get "$env_file" MINIO_SECRET_KEY)"
  MINIO_BUCKET="$(env_get "$env_file" MINIO_BUCKET)"

  MINIO_ENDPOINT="${MINIO_ENDPOINT:-127.0.0.1}"
  MINIO_PORT="${MINIO_PORT:-9000}"
  MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
  MINIO_BUCKET="${MINIO_BUCKET:-perf-attachments}"

  if [[ "$MINIO_USE_SSL" == "true" ]]; then
    MINIO_URL="https://${MINIO_ENDPOINT}:${MINIO_PORT}"
  else
    MINIO_URL="http://${MINIO_ENDPOINT}:${MINIO_PORT}"
  fi

  export MINIO_ENDPOINT MINIO_PORT MINIO_USE_SSL MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET MINIO_URL
}

# 配置 mc alias（临时别名，避免污染用户全局配置）
# 用法: mc_configure_alias <alias_name> [env_file]
mc_configure_alias() {
  local alias_name="$1"
  local env_file="${2:-}"
  require_cmd mc
  if [[ -n "$env_file" ]]; then
    load_minio_from_env "$env_file"
  fi
  mc alias set "$alias_name" "$MINIO_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
}

# 导出 MinIO bucket 到目录
# 用法: minio_export_bucket <env_file> <dest_dir>
minio_export_bucket() {
  local env_file="$1"
  local dest_dir="$2"
  require_cmd mc
  load_minio_from_env "$env_file"
  local alias="perfpack_src_$$"
  mc_configure_alias "$alias" "$env_file"
  mkdir -p "$dest_dir"
  if mc ls "${alias}/${MINIO_BUCKET}" >/dev/null 2>&1; then
    log "导出 MinIO bucket ${MINIO_BUCKET} -> ${dest_dir}"
    mc mirror --overwrite "${alias}/${MINIO_BUCKET}" "$dest_dir"
    log "MinIO 导出完成 ($(du -sh "$dest_dir" | cut -f1))"
  else
    log "警告: 源端 bucket ${MINIO_BUCKET} 不存在或为空，跳过 MinIO 导出"
    mkdir -p "$dest_dir"
  fi
  mc alias remove "$alias" >/dev/null 2>&1 || true
}

# 导入目录到 MinIO bucket
# 用法: minio_import_bucket <env_file> <src_dir>
minio_import_bucket() {
  local env_file="$1"
  local src_dir="$2"
  require_cmd mc
  load_minio_from_env "$env_file"
  local alias="perfpack_dst_$$"
  mc_configure_alias "$alias" "$env_file"

  # 确保 bucket 存在
  if ! mc ls "${alias}/${MINIO_BUCKET}" >/dev/null 2>&1; then
    log "创建 MinIO bucket: ${MINIO_BUCKET}"
    mc mb "${alias}/${MINIO_BUCKET}" || true
  fi

  if [[ -d "$src_dir" ]] && [[ -n "$(ls -A "$src_dir" 2>/dev/null || true)" ]]; then
    log "导入 MinIO -> ${alias}/${MINIO_BUCKET}"
    mc mirror --overwrite "$src_dir" "${alias}/${MINIO_BUCKET}"
    log "MinIO 导入完成"
  else
    log "MinIO 数据目录为空，跳过导入（仅确保 bucket 存在）"
  fi
  mc alias remove "$alias" >/dev/null 2>&1 || true
}

# 国内镜像（npm / pnpm / Prisma 二进制）
apply_china_registry() {
  export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
  export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  export PATH="$PNPM_HOME:$PATH"

  if command -v pnpm >/dev/null 2>&1; then
    pnpm config set registry "$NPM_CONFIG_REGISTRY" >/dev/null 2>&1 || true
  fi
  if command -v npm >/dev/null 2>&1; then
    npm config set registry "$NPM_CONFIG_REGISTRY" >/dev/null 2>&1 || true
  fi

  # Prisma 引擎下载镜像（国内服务器建议设置）
  export PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"

  log "已设置 npm 镜像: $NPM_CONFIG_REGISTRY"
  log "已设置 Prisma 引擎镜像: $PRISMA_ENGINES_MIRROR"
}

# 检测应使用的包管理器（优先看命令行参数，其次看锁文件，最后看命令可用性）
# 输出: "npm" 或 "pnpm"
# 本迁移方案默认推荐 npm；未指定时若存在 package-lock.json 优先 npm
detect_package_manager() {
  local app_dir="${1:-.}"

  # 1. 环境变量/命令行显式指定
  if [[ "${USE_PM:-}" == "npm" || "${USE_PM:-}" == "pnpm" ]]; then
    echo "$USE_PM"
    return 0
  fi

  # 2. 两个锁文件都存在时，优先 npm（迁移目标约定为 npm）
  if [[ -f "$app_dir/package-lock.json" && -f "$app_dir/pnpm-lock.yaml" ]]; then
    echo "npm"
    return 0
  fi

  # 3. 仅 package-lock.json
  if [[ -f "$app_dir/package-lock.json" ]]; then
    echo "npm"
    return 0
  fi

  # 4. 仅 pnpm-lock.yaml
  if [[ -f "$app_dir/pnpm-lock.yaml" ]]; then
    echo "pnpm"
    return 0
  fi

  # 5. 看命令可用性
  if command -v npm >/dev/null 2>&1; then
    echo "npm"
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    echo "pnpm"
    return 0
  fi

  # 6. 默认 npm
  echo "npm"
}

# 确保包管理器可用（自动检测或按参数）
ensure_package_manager() {
  apply_china_registry

  local pm
  pm="$(detect_package_manager "${1:-.}")"

  case "$pm" in
    npm)
      if ! command -v npm >/dev/null 2>&1; then
        die "未安装 npm。请先安装 Node.js 20+（自带 npm）"
      fi
      local npm_ver
      npm_ver="$(npm -v)"
      log "使用 npm v${npm_ver} 安装依赖"
      ;;
    pnpm)
      if command -v pnpm >/dev/null 2>&1; then
        log "使用 pnpm 安装依赖"
        return 0
      fi
      if command -v corepack >/dev/null 2>&1; then
        log "通过 corepack 启用 pnpm"
        corepack enable
        corepack prepare pnpm@9 --activate
        return 0
      fi
      die "未安装 pnpm。请先安装 Node.js 20+ 并执行: corepack enable && corepack prepare pnpm@9 --activate"
      ;;
    *)
      die "未知包管理器: $pm"
      ;;
  esac
}

# 执行包安装（npm ci 或 pnpm install --frozen-lockfile）
install_dependencies() {
  local pm
  pm="$(detect_package_manager "${1:-.}")"

  case "$pm" in
    npm)
      if [[ ! -f package-lock.json ]]; then
        log "无 package-lock.json，使用 npm install"
        npm install
      else
        log "npm ci（使用 package-lock.json 精确安装）"
        if ! npm ci; then
          log "npm ci 失败（lock 与 package.json 可能不同步），回退 npm install"
          npm install
        fi
      fi
      ;;
    pnpm)
      log "pnpm install --frozen-lockfile"
      pnpm install --frozen-lockfile
      ;;
    *)
      die "未知包管理器: $pm"
      ;;
  esac
}

# 执行 Prisma 命令（统一处理 npm/pnpm exec 差异）
# 用法: run_prisma "generate" "$APP_DIR"      — 单子命令
#       run_prisma "migrate deploy" "$APP_DIR" — 多参数（自动拆分）
run_prisma() {
  local pm
  pm="$(detect_package_manager "${2:-.}")"
  local subcmd="${1:-}"
  shift 2 || true

  case "$pm" in
    npm)
      # shellcheck disable=SC2086
      npx prisma $subcmd "$@"
      ;;
    pnpm)
      # shellcheck disable=SC2086
      pnpm exec prisma $subcmd "$@"
      ;;
    *)
      die "未知包管理器: $pm"
      ;;
  esac
}

ensure_pnpm() {
  apply_china_registry
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    log "通过 corepack 启用 pnpm"
    corepack enable
    corepack prepare pnpm@9 --activate
    return 0
  fi
  die "未安装 pnpm。请先安装 Node.js 20+ 并执行: corepack enable && corepack prepare pnpm@9 --activate"
}

ensure_node_version() {
  local min_major=18
  if ! command -v node >/dev/null 2>&1; then
    die "未安装 Node.js（需要 >= ${min_major}，推荐 20 LTS）"
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt "$min_major" ]]; then
    die "Node.js 版本过低: $(node -v)，需要 >= v${min_major}"
  fi
  log "Node $(node -v) / $(command -v node)"
}
