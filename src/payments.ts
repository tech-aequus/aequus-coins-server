//@ts-nocheck
import { Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-09-30.acacia",
});
const prisma = new PrismaClient();

export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { priceId } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });
    res.json({ sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: "Error creating checkout session" });
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await prisma.user.update({
        where: { id: session.client_reference_id },
        data: {
          coins: {
            increment: 100, // Adjust based on the package purchased
          },
        },
      });
    }

    res.json({ received: true });
  } catch (error: any) {
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
};
export const getTransactionHistory = async (
  req: AuthenticatedRequest,

  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });

    const totalCount = await prisma.transaction.count({ where: { userId } });

    res.json({
      transactions,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching transaction history" });
  }
};

export const transferCoins = async (
  req: AuthenticatedRequest,

  res: Response
): Promise<void> => {
  try {
    const senderId = req.user?.userId;
    if (!senderId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { recipientId, amount } = req.body;

    await prisma.$transaction(async (prisma) => {
      const sender = await prisma.user.update({
        where: { id: senderId },
        data: { coins: { decrement: amount } },
      });

      if (sender.coins < 0) {
        throw new Error("Insufficient coins");
      }

      await prisma.user.update({
        where: { id: recipientId },
        data: { coins: { increment: amount } },
      });

      await prisma.transaction.create({
        data: {
          userId: senderId,
          type: "TRANSFER",
          amount: -amount,
          description: `Transfer to user ${recipientId}`,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: recipientId,
          type: "TRANSFER",
          amount,
          description: `Transfer from user ${senderId}`,
        },
      });
    });

    res.json({ message: "Transfer successful" });
  } catch (error) {
    res.status(500).json({ error: "Error processing transfer" });
  }
};

export const getCoinPackages = async (req: Request, res: Response) => {
  try {
    const coinPackages = await prisma.coinPackage.findMany();
    res.json(coinPackages);
  } catch (error) {
    res.status(500).json({ error: "Error fetching coin packages" });
  }
};

export const refundTransaction = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { transactionId } = req.body;

    await prisma.$transaction(async (prisma) => {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId, userId },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (transaction.type !== "PURCHASE") {
        throw new Error("Only purchases can be refunded");
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }

      const newCoinBalance = Math.max(0, user.coins - transaction.amount);
      const refundAmount = user.coins - newCoinBalance;

      await prisma.user.update({
        where: { id: userId },
        data: { coins: newCoinBalance },
      });

      await prisma.transaction.create({
        data: {
          userId,
          type: "REFUND",
          amount: -refundAmount,
          description: `Refund for transaction ${transactionId}`,
        },
      });

      // Here you would typically also process the refund with Stripe
      // This is a placeholder for that logic
      // await stripe.refunds.create({ payment_intent: transaction.stripePaymentIntentId });
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    res.json({
      message: "Refund processed successfully",
      newBalance: updatedUser?.coins,
    });
  } catch (error) {
    res.status(500).json({ error: "Error processing refund" });
  }
};
