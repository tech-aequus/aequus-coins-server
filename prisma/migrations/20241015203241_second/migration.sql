/*
  Warnings:

  - You are about to drop the column `createdAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.
  - Added the required column `description` to the `Transaction` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `Transaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "description" TEXT NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- DropEnum
DROP TYPE "TransactionType";

-- CreateTable
CREATE TABLE "CoinPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coinAmount" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stripePriceId" TEXT NOT NULL,

    CONSTRAINT "CoinPackage_pkey" PRIMARY KEY ("id")
);
