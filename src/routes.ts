import express from "express";
import * as authController from "./auth";
import * as coinsController from "./coins";
import * as paymentsController from "./payments";
import { AuthenticatedRequest } from "./auth";

const router = express.Router();

// Place webhook route first, before any other middleware
router.post(
  "/webhook",
  express.raw({
    type: "application/json",
    verify: (req, res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
  (req, res, next) => {
    console.log(`[${new Date().toISOString()}] Webhook route hit`);

    req.setTimeout(30000);

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

router.put(
  "/add-stripe-coins",
  authController.authenticateToken as express.RequestHandler,
  coinsController.addStripeCoins
);

router.post(
  "/cashout",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.requestCashout
);
router.post(
  "/connect-account",
  authController.authenticateToken as express.RequestHandler,
  paymentsController.createConnectAccount
);
router.post("/add-funds", paymentsController.addFundsForTesting);
router.post("/create-test-clock", paymentsController.createTestClock);
router.post("/advance-test-clock", paymentsController.advanceTestClock);
export default router;
