import { z } from 'zod';

/** 至少 8 位，且包含大写、小写、特殊符号各至少一个 */
export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,128}$/;

export const STRONG_PASSWORD_MESSAGE =
  '密码至少 8 位，且须包含大写字母、小写字母和特殊符号';

export const strongPasswordSchema = z
  .string()
  .trim()
  .min(8, STRONG_PASSWORD_MESSAGE)
  .max(128)
  .regex(STRONG_PASSWORD_REGEX, STRONG_PASSWORD_MESSAGE);

export const basicPasswordSchema = z.string().trim().min(8).max(128);

export function passwordSchemaForPolicy(enforceStrong: boolean) {
  return enforceStrong ? strongPasswordSchema : basicPasswordSchema;
}

export function validatePasswordPolicy(
  plain: string,
  enforceStrong: boolean,
): { ok: true } | { ok: false; message: string } {
  const schema = passwordSchemaForPolicy(enforceStrong);
  const result = schema.safeParse(plain);
  if (result.success) return { ok: true };
  return { ok: false, message: result.error.issues[0]?.message ?? STRONG_PASSWORD_MESSAGE };
}
