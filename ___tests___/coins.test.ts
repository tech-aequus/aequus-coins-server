import request from "supertest";
import express from "express";
import routes from "../src/routes";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());
app.use("/api", routes);

const prisma = new PrismaClient();

describe("Coins and Payments Routes", () => {
  let authToken: string;
  let userId: string;
  let recipientId: string;
  let transactionId: string;

  beforeAll(async () => {
    // Create a test user
    const user = await prisma.user.create({
      data: {
        email: "test@example.com",
        password: "hashedpassword",
        coins: 100,
      },
    });
    userId = user.id;
    authToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string);

    // Create a recipient user
    const recipient = await prisma.user.create({
      data: {
        email: "recipient@example.com",
        password: "hashedpassword",
        coins: 50,
      },
    });
    recipientId = recipient.id;

    // Create a test transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId: userId,
        type: "PURCHASE",
        amount: 100,
        description: "Test purchase",
      },
    });
    transactionId = transaction.id;

    // Create a test coin package
    await prisma.coinPackage.create({
      data: {
        name: "Test Package",
        coinAmount: 100,
        price: 9.99,
        stripePriceId: "price_test123",
      },
    });
  });

  // afterAll(async () => {
  //   // Clean up the test data
  //   await prisma.transaction.deleteMany({
  //     where: { userId: { in: [userId, recipientId] } },
  //   });
  //   await prisma.user.deleteMany({
  //     where: { id: { in: [userId, recipientId] } },
  //   });
  //   await prisma.coinPackage.deleteMany();
  //   await prisma.$disconnect();
  // });

  test("GET /api/total-coins should return total coins for authenticated user", async () => {
    const response = await request(app)
      .get("/api/total-coins")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("totalCoins", 100);
  });

  test("PUT /api/spend should decrease coins for authenticated user", async () => {
    const response = await request(app)
      .put("/api/spend")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ amount: 50 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("newBalance", 50);
  });

  test("GET /api/total-coins should return 401 for unauthenticated request", async () => {
    const response = await request(app).get("/api/total-coins");

    expect(response.status).toBe(401);
  });

  test("GET /api/payments/transaction-history should return paginated transaction history", async () => {
    const response = await request(app)
      .get("/api/payments/transaction-history")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("transactions");
    expect(response.body).toHaveProperty("currentPage");
    expect(response.body).toHaveProperty("totalPages");
    expect(response.body).toHaveProperty("totalCount");
  });

  test("POST /api/payments/transfer should transfer coins between users", async () => {
    const response = await request(app)
      .post("/api/payments/transfer")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ recipientId, amount: 25 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("message", "Transfer successful");

    // Verify the transfer
    const senderResponse = await request(app)
      .get("/api/total-coins")
      .set("Authorization", `Bearer ${authToken}`);
    expect(senderResponse.body).toHaveProperty("totalCoins", 25);

    const recipientToken = jwt.sign(
      { userId: recipientId },
      process.env.JWT_SECRET as string
    );
    const recipientResponse = await request(app)
      .get("/api/total-coins")
      .set("Authorization", `Bearer ${recipientToken}`);
    expect(recipientResponse.body).toHaveProperty("totalCoins", 75);
  });

  test("GET /api/payments/coin-packages should return available coin packages", async () => {
    const response = await request(app).get("/api/payments/coin-packages");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBeTruthy();
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0]).toHaveProperty("name");
    expect(response.body[0]).toHaveProperty("coinAmount");
    expect(response.body[0]).toHaveProperty("price");
    expect(response.body[0]).toHaveProperty("stripePriceId");
  });

  test("POST /api/payments/refund should process a refund", async () => {
    // First, set the user's coin balance to a known value
    await prisma.user.update({
      where: { id: userId },
      data: { coins: 75 },
    });

    const response = await request(app)
      .post("/api/payments/refund")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ transactionId });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty(
      "message",
      "Refund processed successfully"
    );
    expect(response.body).toHaveProperty("newBalance", 0);

    // Verify the refund
    const coinsResponse = await request(app)
      .get("/api/total-coins")
      .set("Authorization", `Bearer ${authToken}`);
    expect(coinsResponse.body).toHaveProperty("totalCoins", 0);
  });
});
