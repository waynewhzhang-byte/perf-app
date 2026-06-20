-- AlterTable: 表单章节绑定一级绩效维度
ALTER TABLE "FormSection" ADD COLUMN "sectionCode" TEXT;
ALTER TABLE "FormSection" ADD COLUMN "maxScore" DECIMAL(10,2);
