export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { getAppConfig } from '@/lib/app-config';

export async function GET() {
  try {
    const config = await getAppConfig();
    return NextResponse.json({ success: true, config });
  } catch (e) {
    console.error('GET /api/public/app-config:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
