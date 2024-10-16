//@ts-nocheck
import { Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-09-30.acacia",
});
const prisma = new PrismaClient();

export const createCheckoutSession = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { priceId } = req.body;

    const coinPackage = await prisma.coinPackage.findFirst({
      where: { stripePriceId: priceId },
    });

    if (!coinPackage) {
      return res.status(404).json({ error: "Coin package not found" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:3000/cancel`,
      client_reference_id: userId,
      metadata: {
        coinAmount: coinPackage.coinAmount.toString(),
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Error creating checkout session" });
  }
};
export const handleWebhook = async (
  req: Request,
  res: Response
): Promise<Void> => {
  const sig = req.headers["stripe-signature"] as string;

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const coinAmount = parseInt(session.metadata?.coinAmount || "0", 10);

      if (userId && coinAmount > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            coins: { increment: coinAmount },
          },
        });

        await prisma.transaction.create({
          data: {
            userId,
            type: "PURCHASE",
            amount: coinAmount,
            description: `Purchased ${coinAmount} coins`,
          },
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
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
): Promise<Void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { transactionId } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId, userId },
    });

    if (!transaction || transaction.type !== "PURCHASE") {
      return res
        .status(404)
        .json({ error: "Valid purchase transaction not found" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const refundAmount = Math.min(transaction.amount, user.coins);

    // Process the refund with Stripe
    // Note: You'll need to store the Stripe PaymentIntent ID with each transaction
    // for this to work. This is just a placeholder.
    // const stripeRefund = await stripe.refunds.create({
    //   payment_intent: transaction.stripePaymentIntentId,
    //   amount: refundAmount * 100, // Stripe uses cents
    // });

    await prisma.$transaction(async (prisma) => {
      await prisma.user.update({
        where: { id: userId },
        data: { coins: { decrement: refundAmount } },
      });

      await prisma.transaction.create({
        data: {
          userId,
          type: "REFUND",
          amount: -refundAmount,
          description: `Refund for transaction ${transactionId}`,
        },
      });
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    res.json({
      message: "Refund processed successfully",
      newBalance: updatedUser?.coins,
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({ error: "Error processing refund" });
  }
};
