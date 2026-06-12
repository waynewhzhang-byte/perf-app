/**
 * PM2 进程配置（由 install-on-server.sh 使用）
 *
 * 环境变量（install 脚本注入）:
 *   APP_DIR      应用根目录，默认 /opt/perf-app
 *   APP_PORT     监听端口，默认 3000
 *   PM2_APP_NAME 进程名，默认 perf-app
 */
const appDir = process.env.APP_DIR || '/opt/perf-app';
const port = process.env.APP_PORT || '3000';
const name = process.env.PM2_APP_NAME || 'perf-app';

module.exports = {
  apps: [
    {
      name,
      cwd: appDir,
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${port}`,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
