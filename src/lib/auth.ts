// JWT 会话 + 角色守卫
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { prisma } from './prisma';
import type { AppRole } from '@prisma/client';

let secretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (!secretKey) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET environment variable is required');
    secretKey = new TextEncoder().encode(jwtSecret);
  }
  return secretKey;
}
const COOKIE_NAME = 'perf_session';
const COOKIE_NAME_ADMIN = 'perf_session_admin';   // 双入口独立 cookie

// ---- Session payload with runtime validation ----

const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  contact: z.string(),
  fullName: z.string(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

// ---- Custom error classes so callers can distinguish auth failures from infra failures ----

export class AuthError extends Error {
  constructor(message = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'FORBIDDEN') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ---- Token & cookie helpers ----

export async function signSession(payload: SessionPayload) {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecretKey());
}

export async function setSessionCookie(token: string, isAdmin = false) {
  cookies().set(isAdmin ? COOKIE_NAME_ADMIN : COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(isAdmin = false) {
  cookies().delete(isAdmin ? COOKIE_NAME_ADMIN : COOKIE_NAME);
}

/** Verify the JWT, validate the payload shape, and confirm the user still exists. */
export async function getSession(isAdmin = false): Promise<SessionPayload | null> {
  const token = cookies().get(isAdmin ? COOKIE_NAME_ADMIN : COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const result = sessionPayloadSchema.safeParse(payload);
    if (!result.success) return null;
    // Verify the user still exists — prevents deleted/disabled users from
    // using tokens that were issued before their account was removed.
    const exists = await prisma.user.findUnique({
      where: { id: result.data.userId },
      select: { id: true },
    });
    if (!exists) return null;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Require the caller to hold a specific role.
 *
 * Throws `AuthError` when the session is missing or the JWT payload lacks a valid
 * `userId`.  Throws `ForbiddenError` when the session is valid but the required
 * role is absent.
 *
 * Callers MUST check `instanceof AuthError` / `instanceof ForbiddenError` before
 * returning a 401/403 — other errors (e.g. Prisma connection failures) should be
 * re-thrown to trigger a 500.
 */
export async function requireRole(role: AppRole, isAdmin = false): Promise<SessionPayload> {
  const session = await getSession(isAdmin);
  if (!session) throw new AuthError('UNAUTHORIZED');

  // Defence-in-depth: treat a missing userId as an auth failure rather than
  // letting Prisma omit the field from the WHERE clause (which would match
  // the first row for that role across ALL users).
  if (!session.userId) throw new AuthError('UNAUTHORIZED');

  const has = await prisma.userRole.findFirst({
    where: { userId: session.userId, role },
  });
  if (!has) throw new ForbiddenError('FORBIDDEN');
  return session;
}

export async function getUserRoles(userId: string): Promise<AppRole[]> {
  const rows = await prisma.userRole.findMany({ where: { userId } });
  return rows.map((r) => r.role);
}

/**
 * Convenience wrapper for admin routes. Verifies the caller holds the ADMIN role.
 *
 * Returns the session on success, or a NextResponse (401/403) on auth failure.
 * All admin route handlers should check:
 *
 *   const session = await requireAdmin();
 *   if (session instanceof NextResponse) return session;
 *
 * Infrastructure errors (e.g. DB down) are re-thrown so the handler's outer
 * try-catch can return a 500.
 */
export async function requireAdmin(): Promise<SessionPayload | ReturnType<typeof NextResponse.json>> {
  try {
    return await requireRole('ADMIN', true);
  } catch (e) {
    if (e instanceof AuthError || e instanceof ForbiddenError) {
      return NextResponse.json({ error: '未授权' }, { status: e instanceof ForbiddenError ? 403 : 401 });
    }
    throw e;
  }
}
