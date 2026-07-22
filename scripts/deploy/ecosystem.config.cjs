/**
 * PM2 进程配置（由 install-on-server.sh / bootstrap 使用）
 *
 * 环境变量（install 脚本注入）:
 *   APP_DIR       应用根目录，默认 /opt/perf-app
 *   APP_PORT      监听端口，默认 3000
 *   PM2_APP_NAME  进程名，默认 perf-app
 *   PM2_INSTANCES 实例数，默认 max（按 CPU 核数集群，适合多员工并发）
 *                 也可设为数字，如 2 / 4
 */
const appDir = process.env.APP_DIR || '/opt/perf-app';
const port = process.env.APP_PORT || '3000';
const name = process.env.PM2_APP_NAME || 'perf-app';
const instances = process.env.PM2_INSTANCES || 'max';

module.exports = {
  apps: [
    {
      name,
      cwd: appDir,
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${port}`,
      instances,
      exec_mode: 'cluster',
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      max_memory_restart: '1G',
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: port,
      },
    },
  ],
};
