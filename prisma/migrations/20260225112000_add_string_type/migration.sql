-- CreateEnum
CREATE TYPE "StringType" AS ENUM ('VIOLAO', 'GUITARRA', 'CONTRABAIXO', 'CAVAQUINHO', 'VIOLA_CAIPIRA', 'VIOLINO');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "stringType" "StringType" NOT NULL DEFAULT 'VIOLAO';

-- DropIndex
DROP INDEX "Product_mlId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_mlId_stringType_key" ON "Product"("mlId", "stringType");

-- CreateIndex
CREATE INDEX "Product_stringType_rank_idx" ON "Product"("stringType", "rank");
