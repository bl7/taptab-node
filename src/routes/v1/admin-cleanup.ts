import { Router, Request, Response } from "express";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { CleanupService } from "../../utils/cleanup";
import { executeQuery } from "../../utils/database";
import { logger } from "../../utils/logger";

const router = Router();

// GET /api/v1/admin/cleanup/pending-orders - Get count of pending orders
router.get(
  "/pending-orders",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (_req: Request, res: Response) => {
    try {
      const count = await CleanupService.getPendingOrdersCount();

      sendSuccess(res, {
        pendingOrdersCount: count,
        message: `There are ${count} pending orders in the system`,
      });
    } catch (error) {
      logger.error("Error getting pending orders count:", error);
      sendError(res, "FETCH_ERROR", "Failed to get pending orders count");
    }
  }
);

// GET /api/v1/admin/cleanup/abandoned-orders - Get abandoned pending orders
router.get(
  "/abandoned-orders",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (_req: Request, res: Response) => {
    try {
      const maxAgeMinutes = parseInt(_req.query["maxAgeMinutes"] as string) || 30;
      const abandonedOrders = await CleanupService.getAbandonedPendingOrders(
        maxAgeMinutes
      );

      sendSuccess(res, {
        abandonedOrders,
        count: abandonedOrders.length,
        maxAgeMinutes,
        message: `Found ${abandonedOrders.length} abandoned orders older than ${maxAgeMinutes} minutes`,
      });
    } catch (error) {
      logger.error("Error getting abandoned orders:", error);
      sendError(res, "FETCH_ERROR", "Failed to get abandoned orders");
    }
  }
);

// POST /api/v1/admin/cleanup/run - Manually trigger cleanup
router.post(
  "/run",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (_req: Request, res: Response) => {
    try {
      const maxAgeMinutes = parseInt(_req.body.maxAgeMinutes as string) || 30;
      const cleanedCount = await CleanupService.cleanupPendingOrders(
        maxAgeMinutes
      );

      sendSuccess(res, {
        cleanedCount,
        maxAgeMinutes,
        message: `Cleanup completed. Cancelled ${cleanedCount} abandoned orders older than ${maxAgeMinutes} minutes`,
      });
    } catch (error) {
      logger.error("Error during manual cleanup:", error);
      sendError(res, "CLEANUP_ERROR", "Failed to run cleanup");
    }
  }
);

// GET /api/v1/admin/cleanup/orders - Clean up old orders
router.get(
  "/orders",
  authenticateToken,
  requireRole(["SUPER_ADMIN"]),
  async (_req: Request, res: Response) => {
    try {
      const maxAgeMinutes =
        parseInt(_req.query["maxAgeMinutes"] as string) || 30;
      const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

      // Delete old orders
      const result = await executeQuery(
        'DELETE FROM orders WHERE "createdAt" < $1 AND status IN ($2, $3) RETURNING id',
        [cutoffTime, "completed", "cancelled"]
      );

      logger.info(`Cleaned up ${result.rows.length} old orders`);
      sendSuccess(
        res,
        { deletedCount: result.rows.length },
        "Cleanup completed successfully"
      );
    } catch (error) {
      logger.error("Admin cleanup error:", error);
      sendError(res, "CLEANUP_ERROR", "Failed to perform cleanup");
    }
  }
);

export default router;
