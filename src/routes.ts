import express from "express";
import * as authController from "./auth";
import * as coinsController from "./coins";
import * as paymentsController from "./payments";
import { AuthenticatedRequest } from "./auth";

const router = express.Router();

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
router.post("/webhook", paymentsController.handleWebhook);

export default router;
