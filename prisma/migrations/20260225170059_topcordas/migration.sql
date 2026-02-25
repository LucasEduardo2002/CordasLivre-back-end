/*
  Warnings:

  - The primary key for the `Product` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `stringType` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Product` table. All the data in the column will be lost.
  - The `id` column on the `Product` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropIndex
DROP INDEX "Product_mlId_stringType_key";

-- DropIndex
DROP INDEX "Product_stringType_rank_idx";

-- AlterTable
ALTER TABLE "Product" DROP CONSTRAINT "Product_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "stringType",
DROP COLUMN "updatedAt",
ADD COLUMN     "type" "StringType" NOT NULL DEFAULT 'VIOLAO',
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Product_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "Product_type_rank_idx" ON "Product"("type", "rank");
