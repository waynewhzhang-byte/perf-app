# Project Context: perf-app (企业员工绩效申报系统)

Enterprise employee performance declaration system with dual-portal access, structured hierarchical reviews, and automated performance archival.

## Project Overview

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.6 (Strict Mode)
- **ORM:** Prisma 5.22 (PostgreSQL)
- **Object Storage:** MinIO (S3-compatible) for attachments
- **Authentication:** JWT (`jose`) with dual-cookie isolation (`perf_session` for employees, `perf_session_admin` for admins)
- **Styling:** Tailwind CSS 3.4
- **Validation:** Zod 3
- **Security:** bcryptjs (passwords), AES-256-GCM (config encryption), rate limiting on login/register.
- **Notifications:** Integrated Aliyun SMS and SMTP Email with dynamic routing based on database configuration.

## Key Architectures & Concepts

### 1. Dual-Portal & Authentication
- The system features two independent portals: Employee (`/`) and Admin (`/admin`).
- Authentication is handled via JWT stored in HTTP-only cookies. Employee and Admin sessions are stored in separate cookies to prevent cross-portal access.
- Role-based access control (RBAC) is enforced using `requireRole` and `requireAdmin` helpers in `src/lib/auth.ts`.
- Roles: `EMPLOYEE`, `REVIEWER_L1` (Branch level), `REVIEWER_L2` (Head office level), `ADMIN`.

### 2. Hierarchical Review Workflow
- **Submission:** Employees submit performance declarations based on active `FormTemplate`s.
- **L1 Review:** Branch-level reviewers (`REVIEWER_L1`) audit submissions item-by-item. They can approve or reject individual items with feedback.
- **L2 Review:** Head office reviewers (`REVIEWER_L2`) perform the final audit on L1-approved submissions.
- **Rejection/Resubmission:** If any item is rejected, the entire submission is returned to the employee. Only rejected items remain editable; others are locked.
- **Archival:** Upon L2 approval, the system generates a `PerformanceRecord` which includes a JSON snapshot (`archivedData`) of the entire submission for permanent storage.

### 3. Dynamic Notification & Config
- **Singletons:** `NotifyConfig` and `AuthConfig` are database singletons (ID=1).
- **Encryption:** Sensitive notification credentials (API keys, SMTP passwords) are encrypted using AES-256-GCM before being stored in the database.
- **Routing:** `src/lib/notify/index.ts` automatically routes notifications to either SMS or Email based on the current active configuration.

### 4. File Storage
- Attachments are stored in MinIO.
- Storage path pattern: `submissions/{submissionId}/{itemId}/{uuid}-{filename}`.
- The `ensureBucket()` utility in `src/lib/minio.ts` handles bucket creation on the fly.

## Development & Operations

### Key Commands

```bash
# Install dependencies
pnpm install

# Infrastructure (Postgres + MinIO)
docker compose -f docker/docker-compose.yml up -d

# Database & Client Generation
pnpm prisma:migrate    # Run migrations
pnpm prisma:generate   # Update Prisma Client

# Development
pnpm dev               # Start at http://localhost:3000

# Production
pnpm build
pnpm start
```

### Initial Setup
1. Copy `.env.example` to `.env` and fill in the required keys.
2. Generate security keys: `openssl rand -hex 32` for `JWT_SECRET` and `NOTIFY_SECRET_KEY`.
3. Visit `/admin/setup` to create the initial super administrator (only accessible when no admin exists).

## Coding Conventions

- **Schema First:** All API inputs must be validated with Zod schemas.
- **API Response:** Use a consistent response format `{ success: true, ...data }` or `{ error: "message" }`.
- **Database Access:** Use the Prisma singleton from `src/lib/prisma.ts`.
- **Auth Guards:** Always use `requireRole` or `requireAdmin` at the top of protected API routes.
- **Error Handling:** Distinguish between `AuthError`, `ForbiddenError`, and generic errors for appropriate status code mapping (401, 403, 500).
- **UI:** Utility-first Tailwind CSS is used throughout. Most UI components are currently inlined within page files.

## Directory Structure Highlights

- `src/app/api`: All backend logic using Next.js Route Handlers.
- `src/app/admin`: Admin dashboard and configuration pages.
- `src/app/(auth)` & `src/app/(employee)`: Employee-facing authentication and performance modules.
- `src/lib`: Core utility libraries (Auth, Notify, MinIO, Crypto, etc.).
- `prisma`: Database schema and migration files.
- `scripts`: Maintenance and seeding scripts.
