import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
// import {
//   getOrderWithItemsQuery,
// } from "./helpers/order-formatters";
import { validateOrderExists } from "./helpers/validation";

const router = Router();

// PUT /api/orders/:id/pay - Mark order as paid (First instance)
router.put(
  "/:id/pay",
  authenticateToken,
  requireRole(["CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { paymentMethod, paidBy } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!paymentMethod) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Payment method is required",
          400
        );
      }

      // Check if order exists
      const existingOrder = await validateOrderExists(id, tenantId, res);
      if (!existingOrder) return;

      const user = (req as any).user;

      // Update order status
      await executeQuery(
        `UPDATE orders 
         SET "paymentStatus" = $1,
             "paymentMethod" = $2,
             "paidByUserId" = $3,
             "paidAt" = $4,
             "updatedAt" = $5
         WHERE id = $6 AND "tenantId" = $7`,
        [
          "PAID",
          paymentMethod,
          user?.id || paidBy,
          new Date(),
          new Date(),
          id,
          tenantId,
        ]
      );

      // Get order with items for notification
      // const orderWithItemsResult = await executeQuery(
      //   getOrderWithItemsQuery(),
      //   [id]
      // );

      // const order = formatOrderFromRows(orderWithItemsResult.rows);

      // Emit WebSocket event for order payment
      try {
        // const paidByUser =
        //   user?.firstName && user?.lastName
        //     ? `${user.firstName} ${user.lastName}`
        //     : user?.id || paidBy || "Unknown";
        // Format order for response
        // const formattedOrder = {
        //   ...order,
        //   paymentStatus: "PAID",
        //   paymentMethod: paymentMethod,
        //   paidBy: paidByUser,
        //   paidAt: new Date(),
        // };
        // socketManager.emitOrderPaid(tenantId, formattedOrder, paymentMethod, paidByUser);
        // TODO: Implement emitOrderPaid method in SocketManager if needed
      } catch (error) {
        logger.error("Failed to emit WebSocket event:", error);
        // Don't fail the order payment if WebSocket fails
      }

      logger.info(`Order marked as paid: ${id} - Method: ${paymentMethod}`);
      sendSuccess(res, { success: true }, "Order marked as paid successfully");
    } catch (error) {
      logger.error("Mark order as paid error:", error);
      sendError(res, "PAYMENT_ERROR", "Failed to mark order as paid");
    }
  }
);

export default router;
