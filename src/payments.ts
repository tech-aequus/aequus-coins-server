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
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { numberOfCoins } = req.body;

    // Validate input
    const coins = parseInt(numberOfCoins);
    if (isNaN(coins) || coins <= 0) {
      return res.status(400).json({ error: "Invalid number of coins" });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Coins Purchase",
              description: `${coins} coins at $1 each`,
            },
            unit_amount: 100, // $1.00 in cents
          },
          quantity: coins,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/paymentcancelled`,
      client_reference_id: userId,
      metadata: {
        userId: userId,
        coinAmount: coins.toString(),
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Error creating checkout session" });
  }
};

export const verifySession = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      res.json({
        success: true,
        message: "Payment successful",
      });
    } else {
      res.json({
        success: false,
        message: "Payment pending or failed",
      });
    }
  } catch (error) {
    console.error("Error verifying session:", error);
    res.status(500).json({ error: "Error verifying payment session" });
  }
};
export const handleWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const event = req.body;

  console.log(
    `[${new Date().toISOString()}] Received webhook event:`,
    event.type
  );

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object as Stripe.Checkout.Session;
        await handleSuccessfulPayment(session);
        break;
      // ... handle other event types as needed
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    // Return a response to acknowledge receipt of the event
    res.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook:`, error);
    res.status(500).json({ error: "Error processing webhook" });
  }
};

async function handleSuccessfulPayment(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const coinAmount = parseInt(session.metadata?.coinAmount || "0", 10);

  if (!userId || coinAmount <= 0) {
    console.error("Invalid metadata in session:", session.id);
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Update user's coins
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: coinAmount } },
      });

      // Create transaction record
      await tx.transaction.create({
        data: {
          userId,
          type: "PURCHASE",
          amount: coinAmount,
          description: `Purchased ${coinAmount} coins`,
          sessionId: session.id, // Store the Stripe session ID
        },
      });
    });

    console.log(`Successfully processed payment for user ${userId}`);
  } catch (error) {
    console.error("Error processing payment:", error);
    // Implement error handling (e.g., retry logic or manual intervention)
  }
}

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
