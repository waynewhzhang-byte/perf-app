/**
 * Next.js Route Handler 共享封装：把"鉴权 + 外层 try/catch + 500 兜底"从每个路由
 * 里抽出来，消除 59 个 route.ts 中重复的 boilerplate。
 *
 * 设计要点（行为保持）：
 * - 仍调用 `requireAdmin()` / `getSession()` 现状签名（`requireAdmin` 返回
 *   `SessionPayload | NextResponse`，`getSession` 返回 `SessionPayload | null`），
 *   未改 `auth.ts`——那是后续全量迁移才需要的。
 * - 默认兜底逐字复刻现状：`console.error('VERB /path:', e)` +
 *   `{ error: '服务器内部错误' }` + 500。
 * - `onError` 钩子让偏离行为（MinIO 503、领域错误类映射、import 文件的消息泄露）
 *   仍可逐路由表达：返回 `Response` 表示已处理，返回 `undefined` 走默认 500。
 *
 * 迁移一个标准 admin 路由只需：
 *   export const GET = withAdmin(async () => { ... });
 *   export const POST = withAdmin(async (req) => { ... });
 */

import { NextResponse } from 'next/server';
import {
  getSession,
  requireAdmin,
  type SessionPayload,
} from '@/lib/auth';

/** 动态路由的第二个参数（Next.js 13/14 风格，非 Promise） */
export interface RouteContext<Params extends Record<string, string>> {
  params: Params;
}

/**
 * 可选错误映射：捕获任意 throw 后，路由作者可返回一个显式 Response（已处理），
 * 或返回 `undefined` 让封装走默认 500 兜底。
 */
export type ErrorMapper = (e: unknown, req: Request) => Response | undefined | Promise<Response | undefined>;

/**
 * 默认 500 兜底：与全仓 55+ 路由现状逐字一致——`console.error('VERB /path:', e)` +
 * `{ error: '服务器内部错误' }`。
 */
function defaultServerError(e: unknown, req: Request): Response {
  console.error(`${req.method} ${nextPath(req)}:`, e);
  return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
}

/**
 * Next.js 的 `req.url` 在反代后可能含完整外部 URL，但现有 `console.error` 习惯
 * 只打印 path（如 `'GET /api/admin/users:'`）。这里取 pathname 近似复刻。
 */
function nextPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return req.url;
  }
}

/**
 * 统一执行 + 错误兜底。鉴权已由调用方完成；本函数只负责跑 handler 并兜 500。
 */
async function runWithErrorBoundary(
  run: () => Promise<Response> | Response,
  req: Request,
  onError?: ErrorMapper,
): Promise<Response> {
  try {
    return await Promise.resolve(run());
  } catch (e) {
    if (onError) {
      const mapped = await onError(e, req);
      if (mapped) return mapped;
    }
    return defaultServerError(e, req);
  }
}

type AdminHandler<Params extends Record<string, string> = Record<string, string>> =
  | ((req: Request, session: SessionPayload) => Promise<Response> | Response)
  | ((req: Request, session: SessionPayload, ctx: RouteContext<Params>) => Promise<Response> | Response);

/**
 * 包裹 admin 路由（要求 ADMIN 角色）。
 *
 * - 鉴权失败时复用 `requireAdmin()` 已有的 401/403 Response（行为与现状一致）。
 * - 通过 `onError` 可注入路由特定的错误映射（MinIO 503、领域错误类等）。
 *
 * 用法：
 *   export const GET = withAdmin(async (_req, session) => { ... });
 *   export const GET = withAdmin(async (_req, _session, { params }) => { ... }, { onError });
 */
export function withAdmin<Params extends Record<string, string> = Record<string, string>>(
  handler: AdminHandler<Params>,
  opts: { onError?: ErrorMapper } = {},
) {
  return async (req: Request, ctx?: RouteContext<Params>): Promise<Response> => {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;
    return runWithErrorBoundary(
      () => (ctx ? (handler as (r: Request, s: SessionPayload, c: RouteContext<Params>) => Promise<Response> | Response)(req, session, ctx) : (handler as (r: Request, s: SessionPayload) => Promise<Response> | Response)(req, session)),
      req,
      opts.onError,
    );
  };
}

type AuthHandler<Params extends Record<string, string> = Record<string, string>> =
  | ((req: Request, session: SessionPayload) => Promise<Response> | Response)
  | ((req: Request, session: SessionPayload, ctx: RouteContext<Params>) => Promise<Response> | Response);

/**
 * 包裹仅需登录（任意角色）的路由：使用 `getSession(isAdmin)`。
 * 鉴权失败时返回 401（与现有 `if (!s) return ... 401` 一致），不抛错。
 *
 * @param opts.isAdmin 是否校验 admin cookie（默认 false，员工 cookie）
 */
export function withAuth<Params extends Record<string, string> = Record<string, string>>(
  handler: AuthHandler<Params>,
  opts: { isAdmin?: boolean; onError?: ErrorMapper } = {},
) {
  const isAdmin = opts.isAdmin ?? false;
  return async (req: Request, ctx?: RouteContext<Params>): Promise<Response> => {
    const session = await getSession(isAdmin);
    if (!session) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    return runWithErrorBoundary(
      () => (ctx ? (handler as (r: Request, s: SessionPayload, c: RouteContext<Params>) => Promise<Response> | Response)(req, session, ctx) : (handler as (r: Request, s: SessionPayload) => Promise<Response> | Response)(req, session)),
      req,
      opts.onError,
    );
  };
}
