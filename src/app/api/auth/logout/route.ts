export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(req: Request) {
  const isAdmin = new URL(req.url).searchParams.get('admin') === '1';
  await clearSessionCookie(isAdmin);
  return NextResponse.json({ success: true });
}
