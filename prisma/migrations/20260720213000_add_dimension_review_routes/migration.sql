CREATE TABLE "DimensionReviewRoute" (
    "id" TEXT NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DimensionReviewRoute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DimensionReviewRoute_dimensionCode_key"
    ON "DimensionReviewRoute"("dimensionCode");
CREATE INDEX "DimensionReviewRoute_departmentId_idx"
    ON "DimensionReviewRoute"("departmentId");

ALTER TABLE "DimensionReviewRoute"
    ADD CONSTRAINT "DimensionReviewRoute_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "DimensionReviewRoute" (
    "id", "dimensionCode", "departmentId", "createdAt", "updatedAt"
)
SELECT
    'dimension-route-' || replace(route."dimensionCode", '.', '-'),
    route."dimensionCode",
    department."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    VALUES
        ('basic.skill-level', '公司组织部'),
        ('basic.title-level', '公司组织部'),
        ('basic.performance-level', '公司组织部'),
        ('performance.safety-contribution', '公司安监部'),
        ('performance.competition', '公司组织部'),
        ('worksite.ticket-execution', '公司安监部'),
        ('worksite.defect-governance', '公司运检部'),
        ('special.violation-severe', '公司安监部'),
        ('special.violation-general', '公司安监部')
) AS route("dimensionCode", "departmentName")
JOIN "Department" AS department ON department."name" = route."departmentName"
JOIN "Branch" AS branch ON branch."id" = department."branchId"
WHERE branch."name" = '公司总部';
