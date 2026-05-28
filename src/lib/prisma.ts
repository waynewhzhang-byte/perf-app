import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Prisma BigInt fields (e.g. Attachment.sizeBytes) are not natively
// serializable by JSON.stringify. Adding toJSON makes them safe for
// NextResponse.json() across all API routes.
declare global {
  interface BigInt {
    toJSON(): number | string;
  }
}

BigInt.prototype.toJSON = function () {
  const num = Number(this);
  if (num > Number.MAX_SAFE_INTEGER) return String(this);
  return num;
};
