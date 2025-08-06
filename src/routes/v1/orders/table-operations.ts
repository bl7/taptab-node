import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
import {
  formatOrderFromRows,
  getOrderWithItemsQuery,
} from "./helpers/order-formatters";
import {
  validateOrderExists,
  validateTableExists,
  validateOrderStatus,
} from "./helpers/validation";

const router = Router();

// PUT /api/v1/orders/:id/move-table - Move order to different table
router.put(
  "/:id/move-table",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { tableId, reason } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      if (!tableId) {
        return sendError(res, "VALIDATION_ERROR", "Table ID is required", 400);
      }

      // Check if order exists and is active
      const order = await validateOrderExists(id, tenantId, res);
      if (!order) return;

      // Check if order can be moved (must be active or pending)
      if (!validateOrderStatus(order, ["active", "pending"], res)) {
        return;
      }

      // Verify new table exists
      if (!(await validateTableExists(tableId, tenantId, res))) {
        return;
      }

      // Check if order is already at the requested table
      if (order.tableNumber === tableId) {
        return sendError(
          res,
          "SAME_TABLE",
          "Order is already at the requested table",
          400
        );
      }

      const user = (req as any).user;
      const oldTable = order.tableNumber;

      // Update order table
      await executeQuery(
        `UPDATE orders SET 
         "tableNumber" = $1, 
         "updatedAt" = $2
         WHERE id = $3`,
        [tableId, new Date(), id]
      );

      // Get updated order with items for response
      const updatedOrderResult = await executeQuery(getOrderWithItemsQuery(), [
        id,
      ]);

      const updatedFormattedOrder = {
        ...formatOrderFromRows(updatedOrderResult.rows),
        oldTable: oldTable,
        newTable: tableId,
        reason: reason || "Table changed",
      };

      // Emit WebSocket event for table move notification
      try {
        const movedBy =
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown";

        // TODO: Implement socketManager.emitTableMove if needed
        logger.info(
          `Order ${id} moved from table ${oldTable} to table ${tableId} by ${movedBy}`
        );
      } catch (error) {
        logger.error("Failed to emit WebSocket event:", error);
        // Don't fail the table move if WebSocket fails
      }

      logger.info(
        `Order moved: ${id} from table ${oldTable} to table ${tableId} - Reason: ${
          reason || "Not specified"
        }`
      );

      sendSuccess(
        res,
        {
          order: updatedFormattedOrder,
          moveDetails: {
            orderId: id,
            fromTable: oldTable,
            toTable: tableId,
            reason: reason || "Table changed",
            movedBy:
              user?.firstName && user?.lastName
                ? `${user.firstName} ${user.lastName}`
                : user?.id || "Unknown",
            movedAt: new Date(),
          },
        },
        "Order moved to new table successfully"
      );
    } catch (error) {
      logger.error("Move table error:", error);
      sendError(res, "MOVE_ERROR", "Failed to move order to new table");
    }
  }
);

export default router;
