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
