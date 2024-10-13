import { Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest } from "./auth";

const prisma = new PrismaClient();

export const getTotalCoins = async (
  req: AuthenticatedRequest,

  res: Response,

  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });
    res.json({ totalCoins: user?.coins || 0 });
  } catch (error) {
    next(error);
  }
};

export const spendCoins = async (
  req: AuthenticatedRequest,

  res: Response,

  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
    }
    const { amount } = req.body;
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        coins: {
          decrement: amount,
        },
      },
    });
    res.json({ newBalance: user.coins });
  } catch (error) {
    next(error);
  }
};
