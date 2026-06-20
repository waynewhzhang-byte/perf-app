-- Fixed declaration header fields and automatic pre-review rules

ALTER TYPE "SubmissionStatus" ADD VALUE 'PRE_REVIEW_REJECTED';

CREATE TABLE "DeclarationLevel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeclarationSpecialty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationSpecialty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutoReviewRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minWorkYears" INTEGER,
    "maxWorkYears" INTEGER,
    "allowedLevelIds" JSONB NOT NULL DEFAULT '[]',
    "rejectMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoReviewRule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Submission"
ADD COLUMN "workAreaName" TEXT,
ADD COLUMN "hireDate" TIMESTAMP(3),
ADD COLUMN "workYears" INTEGER,
ADD COLUMN "declarationLevelId" TEXT,
ADD COLUMN "declarationLevelName" TEXT,
ADD COLUMN "declarationSpecialtyId" TEXT,
ADD COLUMN "declarationSpecialtyName" TEXT,
ADD COLUMN "preReviewPassed" BOOLEAN,
ADD COLUMN "preReviewMessages" JSONB,
ADD COLUMN "preReviewMatchedRules" JSONB;

CREATE UNIQUE INDEX "DeclarationLevel_name_key" ON "DeclarationLevel"("name");
CREATE UNIQUE INDEX "DeclarationSpecialty_name_key" ON "DeclarationSpecialty"("name");

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_declarationLevelId_fkey"
FOREIGN KEY ("declarationLevelId") REFERENCES "DeclarationLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_declarationSpecialtyId_fkey"
FOREIGN KEY ("declarationSpecialtyId") REFERENCES "DeclarationSpecialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
