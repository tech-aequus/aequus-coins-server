import request from "supertest";
import express from "express";
import routes from "../src/routes";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());
app.use("/api", routes);

const prisma = new PrismaClient();

describe("Coins Routes", () => {
  let authToken: string;
  let userId: string;

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
  });

  afterAll(async () => {
    // Clean up the test user
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

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
});
