// 统一通知入口：根据数据库 NotifyConfig 路由到 SMS 或 Email
import { z } from 'zod';
import { prisma } from '../prisma';
import { decrypt } from '../crypto';
import { sendAliyunSms, AliyunSmsConfig } from './aliyun-sms';
import { sendSmtpMail, SmtpConfig } from './smtp';

// Zod schemas for runtime validation after decryption.
// This catches ciphertext corruption and key rotation before downstream
// code operates on mismatched config shapes.
const SmsSchema: z.ZodType<AliyunSmsConfig> = z.object({
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  signName: z.string().min(1),
  templateCode: z.string().min(1),
  noticeTemplateCode: z.string().min(1).optional(),
});

const EmailSchema: z.ZodType<SmtpConfig> = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(1),
});

type LoadedConfig =
  | { channel: 'SMS'; config: AliyunSmsConfig }
  | { channel: 'EMAIL'; config: SmtpConfig };

async function loadConfig(): Promise<LoadedConfig | null> {
  const row = await prisma.notifyConfig.findUnique({ where: { id: 1 } });
  if (!row) return null;

  let plain: unknown;
  try {
    plain = JSON.parse(decrypt(row.configCipher));
  } catch (e) {
    throw new Error(
      `通知配置解密失败：加密密钥可能已轮换或数据已损坏 (${(e as Error).message})`,
    );
  }

  if (row.channel === 'SMS') {
    const result = SmsSchema.safeParse(plain);
    if (!result.success) {
      throw new Error(`SMS 通知配置格式无效：${result.error.message}`);
    }
    return { channel: 'SMS', config: result.data };
  }

  // EMAIL channel
  const result = EmailSchema.safeParse(plain);
  if (!result.success) {
    throw new Error(`邮件通知配置格式无效：${result.error.message}`);
  }
  return { channel: 'EMAIL', config: result.data };
}

export async function getActiveChannel(): Promise<'SMS' | 'EMAIL' | null> {
  const c = await loadConfig();
  return c?.channel ?? null;
}

/** 发送 6 位验证码（注册/找回密码） */
export async function sendVerifyCode(
  target: string,
  code: string,
  purpose: 'register' | 'reset' | 'login',
): Promise<void> {
  const c = await loadConfig();
  if (!c) throw new Error('系统尚未配置通知渠道，请联系管理员');
  if (c.channel === 'SMS') {
    await sendAliyunSms(c.config, target, { code });
  } else {
    const purposeText = { register: '注册', reset: '找回密码', login: '登录' }[purpose];
    await sendSmtpMail(
      c.config,
      target,
      `【绩效申报系统】${purposeText}验证码`,
      `您的验证码：${code}，5 分钟内有效。请勿泄露给他人。`,
    );
  }
}

/** 发送审核状态变更等通用通知 */
export async function sendNotice(target: string, subject: string, body: string): Promise<void> {
  const c = await loadConfig();
  if (!c) return; // 静默失败 - 通用通知不应阻塞业务
  if (c.channel === 'SMS') {
    if (!c.config.noticeTemplateCode) {
      console.warn('短信通知模板未配置，跳过发送。请在管理后台配置 noticeTemplateCode。');
      return;
    }
    await sendAliyunSms(c.config, target, { content: body }, c.config.noticeTemplateCode);
  } else {
    await sendSmtpMail(c.config, target, subject, body);
  }
}
