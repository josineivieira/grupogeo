ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE "VisualAsset" (
 "id" UUID NOT NULL, "ownerId" UUID NOT NULL, "employeeId" UUID, "category" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "size" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VisualAsset_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "VisualAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "VisualAsset_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VisualAsset_storageKey_key" ON "VisualAsset"("storageKey");
CREATE INDEX "VisualAsset_ownerId_category_idx" ON "VisualAsset"("ownerId","category");
