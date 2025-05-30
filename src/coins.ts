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
    const u = await prisma.user.findUnique({
	where:{id:userId},
	select:{coins:true},
    });
    if(!u){
	throw new Error("User Not Found");
	}
    if(u.coins<amount){
        throw new Error("Insufficient Coins");
    }
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


export const addStripeCoins = async (
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
          increment: amount,
        },
      },
    });
    console.log(`User ${userId} added ${amount} coins via Stripe`);
    res.json({ newBalance: user.coins });
  } catch (error) {
    next(error);
  }
};
