import { prisma } from '@/lib/prisma';

export type AuthConfigPublic = {
  registerRequiresVerification: boolean;
  loginRequiresVerification: boolean;
  resetRequiresVerification: boolean;
  enforceStrongPassword: boolean;
};

const DEFAULTS: AuthConfigPublic = {
  registerRequiresVerification: true,
  loginRequiresVerification: false,
  resetRequiresVerification: true,
  enforceStrongPassword: true,
};

export async function getAuthConfig(): Promise<AuthConfigPublic> {
  const row = await prisma.authConfig.findUnique({ where: { id: 1 } });
  if (!row) return { ...DEFAULTS };
  return {
    registerRequiresVerification: row.registerRequiresVerification,
    loginRequiresVerification: row.loginRequiresVerification,
    resetRequiresVerification: row.resetRequiresVerification,
    enforceStrongPassword: row.enforceStrongPassword,
  };
}

export function usesStrongPassword(cfg: AuthConfigPublic): boolean {
  return cfg.enforceStrongPassword;
}
