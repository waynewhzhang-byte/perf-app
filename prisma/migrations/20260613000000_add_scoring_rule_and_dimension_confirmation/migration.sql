-- ScoringRule: 评分规则配置（管理员可维护）
CREATE TABLE "ScoringRule" (
    "id" TEXT NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "dimensionName" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "cap" DECIMAL(10,2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScoringRule_dimensionCode_key" ON "ScoringRule"("dimensionCode");

-- FormItem: 添加 dimensionCode
ALTER TABLE "FormItem" ADD COLUMN "dimensionCode" TEXT;

-- User: 添加入职时间
ALTER TABLE "User" ADD COLUMN "hireDate" TIMESTAMP(3);

-- ConfirmationStatus 枚举 + SubmissionItem 字段
CREATE TYPE "ConfirmationStatus" AS ENUM ('CONFIRMED', 'DISPUTED');

ALTER TABLE "SubmissionItem" ADD COLUMN "confirmationStatus" "ConfirmationStatus";
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeReason" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "isSystemFilled" BOOLEAN NOT NULL DEFAULT false;
