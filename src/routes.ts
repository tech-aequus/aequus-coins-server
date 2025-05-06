import express from "express";
import * as authController from "./auth";
import * as coinsController from "./coins";
import * as paymentsController from "./payments";
import { AuthenticatedRequest } from "./auth";

const router = express.Router();

// Place webhook route first, before any other middleware
// In routes.ts
router.post(
  "/webhook",
  express.raw({
    type: "application/json",
    verify: (req, res, buf) => {
      // Store raw body for signature verification
      (req as any).rawBody = buf;
    },
  }),
  (req, res, next) => {
    console.log(`[${new Date().toISOString()}] Webhook route hit`);

    // Configure request
    req.setTimeout(30000);

    // Less strict content type checking
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      console.error(
        `[${new Date().toISOString()}] Invalid content type:`,
        contentType
      );
      res.status(400).send("Invalid content type");
    } else {
      next();
    }
  },
  paymentsController.handleWebhook
);
// Make sure this comes AFTER the webhook route

// JSON parser middleware for all other routes
router.use(express.json());

// Auth routes
router.post("/register", authController.register);
router.post("/login", authController.login);

router.get(
  "/total-coins",
  authController.authenticateToken,
  coinsController.getTotalCoins
);

router.put(
  "/spend",
  authController.authenticateToken,
  coinsController.spendCoins
);

router.post(
  "/checkout",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.createCheckoutSession
);

router.get(
  "/payments/transaction-history",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.getTransactionHistory
);

router.post(
  "/payments/transfer",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.transferCoins
);

router.get("/payments/coin-packages", paymentsController.getCoinPackages);

router.post(
  "/payments/refund",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.refundTransaction
);

router.get("/verify-session/:sessionId", paymentsController.verifySession);

router.post(
  "/add-coins",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.addCoins
);

export default router;
