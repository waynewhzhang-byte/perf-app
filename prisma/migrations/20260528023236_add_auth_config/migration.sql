-- CreateTable
CREATE TABLE "AuthConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "registerRequiresVerification" BOOLEAN NOT NULL DEFAULT true,
    "loginRequiresVerification" BOOLEAN NOT NULL DEFAULT false,
    "resetRequiresVerification" BOOLEAN NOT NULL DEFAULT true,
    "enforceStrongPassword" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AuthConfig_pkey" PRIMARY KEY ("id")
);
