-- CreateEnum
CREATE TYPE "MaintenanceAlertLevel" AS ENUM ('OK', 'SOON', 'DUE', 'OVERDUE');

-- CreateTable
CREATE TABLE "StringMaintenance" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT NOT NULL,
    "type" "StringType" NOT NULL DEFAULT 'VIOLAO',
    "lastChangeDate" TIMESTAMP(3) NOT NULL,
    "studyHoursPerWeek" INTEGER NOT NULL,
    "estimatedLifeDays" INTEGER NOT NULL,
    "nextAlertDate" TIMESTAMP(3) NOT NULL,
    "alertLevel" "MaintenanceAlertLevel" NOT NULL DEFAULT 'OK',
    "alertMessage" TEXT,
    "affiliateUrl" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StringMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StringMaintenance_userEmail_type_key" ON "StringMaintenance"("userEmail", "type");

-- CreateIndex
CREATE INDEX "StringMaintenance_nextAlertDate_alertLevel_idx" ON "StringMaintenance"("nextAlertDate", "alertLevel");
