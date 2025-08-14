import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { socketManager } from "../../utils/socket";
import { getTenantId } from "../../middleware/tenant";

const router = Router();

// POST /api/v1/test/websocket - Test WebSocket notification
router.post(
  "/websocket",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const testOrder = {
        id: "test_order_" + Date.now(),
        orderNumber: "TEST-" + Date.now(),
        tableNumber: "TEST",
        totalAmount: 25.5,
        finalAmount: 25.5,
        status: "active", // Order is active and visible
        paymentStatus: "paid", // Payment is confirmed
        paymentMethod: "STRIPE",
        orderSource: "QR_ORDERING", // Always visible on table
        customerName: "Test Customer",
        customerPhone: "5555555555",
        items: [
          {
            id: "test_item_1",
            menuItemId: "test_menu_item",
            menuItemName: "Test Item",
            quantity: 1,
            price: 25.5,
            total: 25.5,
            notes: "Test notification",
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      logger.info("🧪 Testing WebSocket notification...");
      logger.info("📦 Test order data:", testOrder);

      // Get tenant ID from authenticated user
      const tenantId = (req as any).user?.tenantId;

      if (!tenantId) {
        return sendError(res, "UNAUTHORIZED", "No tenant ID found", 401);
      }

      logger.info(`📡 Emitting test notification for tenant: ${tenantId}`);
      socketManager.emitNewOrder(tenantId, testOrder);

      sendSuccess(res, {
        message: "Test WebSocket notification sent",
        order: testOrder,
        tenantId,
      });
    } catch (error) {
      logger.error("Test WebSocket error:", error);
      sendError(res, "TEST_ERROR", "Failed to send test notification");
    }
  }
);

// Debug route to test authentication
router.get("/auth-test", authenticateToken, (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const tenantId = getTenantId(req);

    return sendSuccess(
      res,
      {
        authenticated: true,
        user: {
          id: user?.id,
          email: user?.email,
          role: user?.role,
          tenantId: user?.tenantId,
        },
        extractedTenantId: tenantId,
        headers: {
          authorization: req.headers.authorization ? "Present" : "Missing",
          "x-tenant-slug": req.headers["x-tenant-slug"] || "Missing",
          tenant: req.query["tenant"] || "Missing",
        },
      },
      "Authentication test successful"
    );
  } catch (error) {
    return sendError(res, "DEBUG_ERROR", `Debug error: ${error}`);
  }
});

// Debug route without authentication
router.get("/no-auth", (req: Request, res: Response) => {
  return sendSuccess(
    res,
    {
      message: "No auth required",
      headers: {
        authorization: req.headers.authorization ? "Present" : "Missing",
        "x-tenant-slug": req.headers["x-tenant-slug"] || "Missing",
        tenant: req.query["tenant"] || "Missing",
      },
    },
    "No auth test successful"
  );
});

export default router;
