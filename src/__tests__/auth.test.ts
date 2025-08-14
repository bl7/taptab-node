import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { authenticateToken, requireRole } from "../middleware/auth";

const app = express();

// Test route that uses authentication
app.get("/test", authenticateToken, requireRole(["MANAGER"]), (req, res) => {
  res.json({ success: true, user: req.user });
});

describe("Authentication Middleware", () => {
  const mockSecret = "test-secret";
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = mockSecret;
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  describe("authenticateToken", () => {
    it("should return 401 when no token is provided", async () => {
      const response = await request(app).get("/test").expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NO_TOKEN_PROVIDED");
    });

    it("should return 401 when invalid token is provided", async () => {
      const response = await request(app)
        .get("/test")
        .set("Authorization", "Bearer invalid-token")
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("INVALID_TOKEN");
    });

    it("should return 401 when token is expired", async () => {
      const expiredToken = jwt.sign(
        {
          id: "test-user",
          role: "MANAGER",
          tenantId: "test-tenant",
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
        mockSecret
      );

      const response = await request(app)
        .get("/test")
        .set("Authorization", `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("TOKEN_EXPIRED");
    });
  });

  describe("requireRole", () => {
    it("should return 401 when user is not authenticated", async () => {
      const response = await request(app).get("/test").expect(401);

      expect(response.body.success).toBe(false);
    });

    it("should return 403 when user does not have required role", async () => {
      const token = jwt.sign(
        {
          id: "test-user",
          role: "CASHIER",
          tenantId: "test-tenant",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        mockSecret
      );

      const response = await request(app)
        .get("/test")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("INSUFFICIENT_PERMISSIONS");
    });
  });
});
