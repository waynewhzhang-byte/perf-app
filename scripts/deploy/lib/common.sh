#!/usr/bin/env bash
# 部署脚本公共函数（pack / install 共用）

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

# 从 .env 读取 DATABASE_URL（简单解析，支持常见 postgresql URL）
load_database_url_from_env() {
  local env_file="$1"
  [[ -f "$env_file" ]] || die "环境文件不存在: $env_file"

  local line url
  line="$(grep -E '^[[:space:]]*DATABASE_URL=' "$env_file" | tail -n1 || true)"
  [[ -n "$line" ]] || die "$env_file 中未找到 DATABASE_URL"

  url="${line#DATABASE_URL=}"
  url="${url#\"}"
  url="${url%\"}"
  url="${url#\'}"
  url="${url%\'}"

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
detect_package_manager() {
  local app_dir="${1:-.}"

  # 1. 环境变量/命令行显式指定
  if [[ "${USE_PM:-}" == "npm" || "${USE_PM:-}" == "pnpm" ]]; then
    echo "$USE_PM"
    return 0
  fi

  # 2. 两个锁文件都存在时，选修改时间更新的（避免 npm ci 因锁文件过期而失败）
  if [[ -f "$app_dir/package-lock.json" && -f "$app_dir/pnpm-lock.yaml" ]]; then
    if [[ "$app_dir/package-lock.json" -nt "$app_dir/pnpm-lock.yaml" ]]; then
      echo "npm"
    else
      # pnpm-lock.yaml 更新，或时间戳相同（开发用 pnpm，优先信任）
      echo "pnpm"
    fi
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

  # 4. 看命令可用性
  if command -v npm >/dev/null 2>&1; then
    echo "npm"
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    echo "pnpm"
    return 0
  fi

  # 5. 默认 npm（几乎所有 Node.js 自带）
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
      log "npm ci（使用 package-lock.json 精确安装）"
      npm ci
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
