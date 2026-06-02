-- Option-level second review permissions and review records

CREATE TYPE "OptionReviewStatus" AS ENUM ('PENDING_L2', 'L2_APPROVED', 'REJECTED');

CREATE TABLE "FormOptionReviewer" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormOptionReviewer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionOptionReview" (
    "id" TEXT NOT NULL,
    "submissionItemId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" DECIMAL(10,2) NOT NULL,
    "count" INTEGER,
    "departmentId" TEXT NOT NULL,
    "status" "OptionReviewStatus" NOT NULL DEFAULT 'PENDING_L2',
    "rejectReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionOptionReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormOptionReviewer_itemId_optionId_key" ON "FormOptionReviewer"("itemId", "optionId");
CREATE INDEX "FormOptionReviewer_departmentId_idx" ON "FormOptionReviewer"("departmentId");
CREATE UNIQUE INDEX "SubmissionOptionReview_submissionItemId_optionId_key" ON "SubmissionOptionReview"("submissionItemId", "optionId");
CREATE INDEX "SubmissionOptionReview_departmentId_status_idx" ON "SubmissionOptionReview"("departmentId", "status");

ALTER TABLE "FormOptionReviewer" ADD CONSTRAINT "FormOptionReviewer_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "FormItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FormOptionReviewer" ADD CONSTRAINT "FormOptionReviewer_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubmissionOptionReview" ADD CONSTRAINT "SubmissionOptionReview_submissionItemId_fkey"
FOREIGN KEY ("submissionItemId") REFERENCES "SubmissionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubmissionOptionReview" ADD CONSTRAINT "SubmissionOptionReview_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "FormItem" fi
SET "scoreOptions" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem.value ? 'optionId' THEN elem.value
      ELSE jsonb_set(elem.value, '{optionId}', to_jsonb(fi.id || ':' || ((elem.ordinality - 1)::text)))
    END
    ORDER BY elem.ordinality
  )
  FROM jsonb_array_elements(fi."scoreOptions"::jsonb) WITH ORDINALITY AS elem(value, ordinality)
)
WHERE jsonb_typeof(fi."scoreOptions"::jsonb) = 'array';
