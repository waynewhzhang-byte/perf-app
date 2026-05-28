export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { getAuthConfig } from '@/lib/auth-config';
import { STRONG_PASSWORD_MESSAGE } from '@/lib/password-policy';

export async function GET() {
  try {
    const config = await getAuthConfig();
    return NextResponse.json({
      success: true,
      config,
      passwordHint: config.enforceStrongPassword
        ? STRONG_PASSWORD_MESSAGE
        : '密码至少 8 位',
    });
  } catch (e) {
    console.error('GET /api/public/auth-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
