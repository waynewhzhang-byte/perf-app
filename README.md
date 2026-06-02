# 企业员工绩效申报系统（本地化部署版）

技术栈：**Next.js 14 (App Router) + TypeScript + Prisma + PostgreSQL + MinIO + Tailwind**

> 本项目为可在自有服务器/内网部署的版本。包含双入口（员工端 `/` 与管理端 `/admin`）、手机+密码+短信注册、两级审核、申报项级别驳回、年度绩效档案、按分公司/年度批量导出 ZIP。

---

## 一、快速启动（本地开发）

```bash
# 1. 克隆并安装依赖
pnpm install                     # 或 npm install / yarn

# 2. 启动 PostgreSQL + MinIO
docker compose -f docker/docker-compose.yml up -d

# 3. 复制环境变量
cp .env.example .env             # 然后按需修改

# 4. 初始化数据库
pnpm prisma migrate dev --name init
pnpm prisma generate

# 5. 启动开发服务
pnpm dev                         # http://localhost:3000
```

首次访问 `http://localhost:3000/admin/setup` 创建**首个超级管理员**（仅在系统无 admin 时可访问），之后即从 `/admin/login` 登录。

---

## 二、目录结构

```
perf-app/
├── prisma/
│   └── schema.prisma            # 数据模型（PostgreSQL）
├── docker/
│   └── docker-compose.yml       # Postgres + MinIO
├── src/
│   ├── app/
│   │   ├── (auth)/login         # 员工登录、注册、找回密码
│   │   ├── (employee)/app/...   # 员工申报、个人中心
│   │   ├── admin/setup          # 首个管理员引导（一次性）
│   │   ├── admin/login          # 管理员登录
│   │   ├── admin/...            # 管理后台（组织/表单/审核员/通知设置/导出）
│   │   └── api/                 # 所有 REST API
│   ├── lib/
│   │   ├── prisma.ts            # Prisma 单例
│   │   ├── auth.ts              # JWT + 会话 + 角色守卫
│   │   ├── password.ts          # bcrypt 哈希
│   │   ├── notify/              # 通知渠道（短信/邮件）抽象
│   │   │   ├── index.ts         # sendCode/sendNotice 统一入口
│   │   │   ├── aliyun-sms.ts    # 阿里云短信实现
│   │   │   └── smtp.ts          # SMTP 邮件实现
│   │   ├── minio.ts             # MinIO 上传/预签名 URL
│   │   └── export-zip.ts        # 归档 ZIP 打包（archiver）
│   └── components/              # UI 组件
├── .env.example
└── package.json
```

---

## 三、关键配置

### 3.1 数据库（PostgreSQL）

`.env` 中：
```
DATABASE_URL="postgresql://perf:perf@localhost:5432/perf?schema=public"
```

### 3.2 MinIO（附件存储）

`.env` 中（默认账号 `minioadmin` / `minioadmin`）：
```
# 应用进程连接 MinIO（上传、导出 ZIP、bucket 检查）
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=perf-attachments

# 浏览器打开附件时的预签名 URL（员工可访问的 IP 或域名；不配则与 MINIO_* 相同）
# MINIO_PUBLIC_ENDPOINT=your-server-public-ip-or-domain
# MINIO_PUBLIC_PORT=9000
# MINIO_PUBLIC_USE_SSL=false
```

本地开发若 MinIO 只监听 `localhost`，`MINIO_ENDPOINT` 填 `127.0.0.1` 或 `localhost` 均可。

**两种启动方式（二选一）：**

| 方式 | 启动命令 | S3 API | Web 控制台 |
|------|----------|--------|------------|
| 本机二进制 | `minio server ./minio-data` | `http://127.0.0.1:9000` | 启动日志里的 WebUI 端口（每次可能不同，如 `49330`） |
| Docker Compose | `docker compose -f docker/docker-compose.yml up -d minio` | `http://localhost:9000` | `http://localhost:9001` |

应用只连接 **9000** 端口的 S3 API；控制台仅用于人工查看文件。首次上传附件时应用会自动创建 `perf-attachments` bucket（已用当前配置验证通过）。

### 3.3 通知渠道（管理员后台配置）

**无需在 `.env` 写死短信/邮件配置**。管理员登录后到 **系统设置 → 通知渠道**：
- 选择渠道：**阿里云短信** 或 **SMTP 邮件**
- 录入对应密钥（阿里云：AccessKeyId/Secret/SignName/TemplateCode；SMTP：host/port/user/pass/from）
- 保存后立即生效；密码以 AES-256-GCM 加密存于数据库

切换通知渠道不需要重启服务。

### 3.4 加密密钥（必须设置）

`.env` 中：
```
NOTIFY_SECRET_KEY=请生成32字节随机串                # 用于加密通知渠道密钥
JWT_SECRET=请生成32字节随机串                      # 用于签发会话 JWT
```

生成方式：`openssl rand -hex 32`

---

## 四、首个管理员引导流程

1. 系统启动后访问 `GET /admin/setup`
2. 后端检查 `user_roles` 表中是否已存在 `ADMIN` 角色用户
   - 若已存在 → 自动 302 跳转 `/admin/login`，禁止重复引导
   - 若不存在 → 显示引导表单：手机号 / 姓名 / 密码 / **本次跳过短信验证码**（因尚未配置通知渠道）
3. 提交后：创建 user + profile，写入 `ADMIN` 角色
4. 引导后强制跳转 **系统设置 → 通知渠道**，要求选择并配置一种渠道，否则后续注册流程无法发送验证码

---

## 五、通知渠道抽象

`src/lib/notify/index.ts` 暴露：
```ts
sendVerifyCode(phoneOrEmail: string, code: string, purpose: 'register'|'reset'|'login')
sendNotice(target: string, subject: string, body: string)
```

实现内部根据数据库中的 `NotifyConfig` 路由到 `aliyun-sms.ts` 或 `smtp.ts`。
- 渠道=SMS 时，`phoneOrEmail` 视为手机号；用户表 `contact` 字段存手机号
- 渠道=EMAIL 时，`phoneOrEmail` 视为邮箱；用户注册改用邮箱

> 管理员可在初始化时为系统选择「主要联系方式」（phone / email）。一旦选择，所有用户注册按该方式进行；中途切换需运维评估。

---

## 六、申报与审核流程

1. **员工**进入 `/app`：选择已发布表单 → 逐项填写（分值选择 + 内容 + 附件）→ 可随时**保存草稿** → 提交
2. **一级审核员**（按分公司分配）在 `/app/review` 看到本分公司提交：**逐项**通过/驳回，可填写驳回理由
3. 全部通过 → 流转**二级审核员**（总公司）
4. 二级通过 → 自动汇总 `total_score` 并写入 `PerformanceRecord`（年度档案）
5. 任一级别驳回某项 → 整个 submission 回到员工，状态变为 `REJECTED`，但**只允许编辑被驳回的 item**，其余项锁定；重提后只有改动的项再次走审核

---

## 七、数据导出

管理员 `/admin/export` 选择 **分公司 + 年度** → 后端按 PerformanceRecord 拉取归档 JSON、所有 submission_item、附件二进制（从 MinIO 拉取）→ `archiver` 流式打包 ZIP → 浏览器下载。

目录结构：
```
{branch}-{year}.zip
├── manifest.csv                 # 员工列表 + 总分
└── {employeeNo}-{fullName}/
    ├── archive.json
    └── attachments/
        ├── item1-证书.pdf
        └── ...
```

---

## 八、生产部署建议

- 反向代理：Nginx，证书用 Let's Encrypt 或企业 CA
- PostgreSQL：建议独立部署 + 定时 `pg_dump` 备份
- MinIO：生产用分布式模式 + 异地备份
- Next.js：`pnpm build && pnpm start`（或 Docker 化）
- 日志：建议接入 Loki / ELK；审计日志已落库 `ReviewLog`

### MinIO 与 Next.js 同机部署（避免附件 ETIMEDOUT）

Next.js 与 MinIO 在同一台云主机时，**切勿**将 `MINIO_ENDPOINT` 设为该机公网 IP。多数云厂商不支持本机经公网 IP 回连（hairpin），会出现 `connect ETIMEDOUT`，而 `ss` 仍显示 9000 在监听。

在服务器上自检：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/minio/health/live
curl -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 5 http://YOUR_PUBLIC_IP:9000/minio/health/live
```

推荐配置：

| 变量 | 值 | 用途 |
|------|-----|------|
| `MINIO_ENDPOINT` | `127.0.0.1` | 应用服务端上传、下载、导出 |
| `MINIO_PUBLIC_ENDPOINT` | 公网 IP 或 `minio.example.com` | 仅用于生成员工浏览器可打开的预签名 URL |

修改 `.env` 后须**重启** Next.js 进程。若通过 Nginx 以 HTTPS 暴露 MinIO，将 `MINIO_PUBLIC_*` 设为域名并设 `MINIO_PUBLIC_USE_SSL=true`。

---

## 九、待完成 / TODO

为节省篇幅，以下模块给出了骨架与关键接口，可按业务进一步打磨：
- 表单设计器的可视化拖拽（当前为表单 + JSON 配置）
- 审核员的复杂权限矩阵（当前为「按分公司」单维度）
- 国际化 / 移动端 UI 优化

如需我继续扩展某个具体模块，告诉我模块名即可。
