//@ts-nocheck
import { Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { AuthenticatedRequest } from "./auth";

dotenv.config();

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
      success_url: `${process.env.FRONTEND_URL}/store`,
      cancel_url: `${process.env.FRONTEND_URL}/store`,
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
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
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
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: coinAmount } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: "PURCHASE",
          amount: coinAmount,
          description: `Purchased ${coinAmount} coins`,
          sessionId: session.id,
        },
      });
    });

    console.log(`Successfully processed payment for user ${userId}`);
  } catch (error) {
    console.error("Error processing payment:", error);
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

export const addCoins = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { amount, reason } = req.body;

    const coins = parseInt(amount);
    if (isNaN(coins) || coins <= 0) {
      return res.status(400).json({ error: "Invalid number of coins" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: coins } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: "REWARD",
          amount: coins,
          description: reason || `Reward: ${coins} coins added`,
        },
      });
    });

    res.json({
      success: true,
      message: `Successfully added ${coins} coins to user account`,
    });
  } catch (error) {
    console.error("Error adding coins:", error);
    res.status(500).json({ error: "Error adding coins to user account" });
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

export const requestCashout = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { amount } = req.body;
    const coins = parseInt(amount);
    if (isNaN(coins) || coins <= 0) {
      return res.status(400).json({ error: "Invalid number of coins" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, coins: true, stripeAccountId: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.coins < coins) {
      return res.status(400).json({ error: "Insufficient coins" });
    }

    if (!user.stripeAccountId) {
      return res.status(400).json({
        error: "No bank account linked. Please set up a payment account.",
      });
    }

    // Convert coins to USD cents (1 coin = $1 = 100 cents)
    const amountInCents = coins * 100;

    // Create a Stripe transfer to the user's connected account
    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: "gbp",
      destination: user.stripeAccountId,
      description: `Cash out ${coins} coins for user ${userId}`,
    });

    // Update user coins and create transaction record
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { coins: { decrement: coins } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: "CASHOUT",
          amount: -coins,
          description: `Cashed out ${coins} coins to bank account`,
        },
      });
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });

    res.json({
      success: true,
      message: `Successfully requested cash out of ${coins} coins`,
      newBalance: updatedUser?.coins,
    });
  } catch (error) {
    console.error("Error processing cash out:", error);
    res.status(500).json({ error: "Error processing cash out" });
  }
};

export const createConnectAccount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, stripeAccountId: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let stripeAccountId = user.stripeAccountId;

    // Create a new Connected Account if none exists
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      // Update user with stripeAccountId
      await prisma.user.update({
        where: { id: userId },
        data: { stripeAccountId },
      });
    }

    // Create an Account Link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/store`,
      return_url: `${process.env.FRONTEND_URL}/store`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (error) {
    console.error("Error creating Connect account:", error);
    res.status(500).json({ error: "Error setting up payment account" });
  }
};
// export const addFundsForTesting = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const charge = await stripe.charges.create({
//       amount: 100000, // £1000.00 in pence
//       currency: "gbp",
//       source: "tok_visa", // Simulates a successful charge; funds are immediately available
//       description: "Adding funds for testing cash out",
//     });
//     res.json({ success: true, charge });
//   } catch (error) {
//     console.error("Error adding funds:", error);
//     res.status(500).json({ error: "Failed to add funds" });
//   }
// };
export const addFundsForTesting = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("Creating charge with pre-existing test token...");

    const charge = await stripe.charges.create({
      amount: 100000, // £1000.00 in pence
      currency: "gbp",
      source: "tok_visa", // Use a pre-existing test token
      description:
        "Adding funds for testing cash out with immediate availability",
      statement_descriptor: "TEST FUNDS",
      capture: true,
    });

    console.log("Charge created successfully:", charge);
    res.json({ success: true, charge });
  } catch (error: any) {
    console.error("Error adding funds:", error);
    res.status(500).json({
      error: error.message || "Failed to add funds",
    });
  }
};

export const createTestClock = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: new Date("2025-06-12T18:34:00Z").getTime() / 1000, // Current time in UTC (12:04 AM IST = 18:34 UTC on June 12)
      name: "Test clock for advancing payout schedule",
    });

    console.log("Test clock created:", testClock);
    res.json({ success: true, testClockId: testClock.id });
  } catch (error: any) {
    console.error("Error creating test clock:", error);
    res.status(500).json({
      error: error.message || "Failed to create test clock",
    });
  }
};

export const advanceTestClock = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { testClockId } = req.body;

    if (!testClockId) {
      return res.status(400).json({ error: "Test clock ID required" });
    }

    const advancedClock = await stripe.testHelpers.testClocks.advance(
      testClockId,
      {
        frozen_time: new Date("2025-06-19T18:34:00Z").getTime() / 1000, // Advance to June 19, 2025
      }
    );

    console.log("Test clock advanced:", advancedClock);
    res.json({ success: true, advancedClock });
  } catch (error: any) {
    console.error("Error advancing test clock:", error);
    res.status(500).json({
      error: error.message || "Failed to advance test clock",
    });
  }
};
