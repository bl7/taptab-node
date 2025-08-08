import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
import { validateTableExists } from "./helpers/validation";

const router = Router();

// PUT /api/v1/orders/:orderId/close - Close a specific order
router.put(
  "/:orderId/close",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;
      const { reason = "Order closed by staff" } = req.body;

      logger.info(`🔍 Closing order: ${orderId} for tenant: ${tenantId}`);

      // Get the order to verify it exists and is active
      const orderResult = await executeQuery(
        `SELECT id, "orderNumber", status, "paymentStatus", "paymentMethod", "customerName", 
                "totalAmount", "finalAmount", "tableNumber", "createdAt"
         FROM orders 
         WHERE id = $1 AND "tenantId" = $2`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "ORDER_NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];
      logger.info(`📦 Found order: ${order.orderNumber} (${order.status})`);

      // Check if order is already closed
      if (order.status === "closed") {
        return sendError(
          res,
          "ORDER_ALREADY_CLOSED",
          "Order is already closed",
          400
        );
      }

      // Check if order is cancelled
      if (order.status === "cancelled") {
        return sendError(
          res,
          "ORDER_CANCELLED",
          "Cannot close a cancelled order",
          400
        );
      }

      // Close the order
      const closeOrderResult = await executeQuery(
        `UPDATE orders 
          SET status = 'closed', 
              "updatedAt" = $1,
              "closedAt" = $1,
              "closedByUserId" = $2,
              "closedByUserName" = $3
          WHERE id = $4 AND "tenantId" = $5 AND status != 'closed'`,
        [
          new Date(),
          (req as any).user?.id || null,
          (req as any).user?.firstName && (req as any).user?.lastName
            ? `${(req as any).user.firstName} ${(req as any).user.lastName}`
            : (req as any).user?.email || "Unknown",
          orderId,
          tenantId,
        ]
      );

      if (closeOrderResult.rowCount === 0) {
        return sendError(
          res,
          "ORDER_ALREADY_CLOSED",
          "Order is already closed or cannot be closed",
          400
        );
      }

      logger.info(`✅ Closed order ${orderId}`);

      // Get the updated order for response
      const updatedOrderResult = await executeQuery(
        `SELECT id, "orderNumber", status, "paymentStatus", "paymentMethod", "customerName", 
                "totalAmount", "finalAmount", "tableNumber", "createdAt", "updatedAt", "closedAt"
         FROM orders 
         WHERE id = $1`,
        [orderId]
      );

      const closedOrder = updatedOrderResult.rows[0];

      const orderData = {
        id: closedOrder.id,
        orderNumber: closedOrder.orderNumber,
        status: closedOrder.status,
        paymentStatus: closedOrder.paymentStatus,
        paymentMethod: closedOrder.paymentMethod,
        customerName: closedOrder.customerName,
        totalAmount: parseFloat(closedOrder.totalAmount?.toString() || "0"),
        finalAmount: parseFloat(closedOrder.finalAmount?.toString() || "0"),
        tableNumber: closedOrder.tableNumber,
        createdAt: closedOrder.createdAt,
        closedAt: closedOrder.closedAt,
        updatedAt: closedOrder.updatedAt,
      };

      logger.info(`✅ Order ${orderId} closed successfully`);
      sendSuccess(
        res,
        {
          order: orderData,
          closedBy:
            (req as any).user?.firstName && (req as any).user?.lastName
              ? `${(req as any).user.firstName} ${(req as any).user.lastName}`
              : (req as any).user?.email || "Unknown",
          closedAt: new Date(),
          ...(reason && { reason }),
        },
        "Order closed successfully"
      );
    } catch (error) {
      logger.error("Close order error:", error);
      sendError(res, "CLOSE_ORDER_ERROR", "Failed to close order");
    }
  }
);

// GET /api/v1/orders/tables/:tableId/status - Get table status and active orders
router.get(
  "/tables/:tableId/status",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { tableId } = req.params;

      logger.info(
        `🔍 Getting status for table: ${tableId} for tenant: ${tenantId}`
      );

      // Get table info
      const tableResult = await executeQuery(
        'SELECT * FROM tables WHERE id = $1 AND "tenantId" = $2',
        [tableId, tenantId]
      );

      if (tableResult.rows.length === 0) {
        return sendError(res, "TABLE_NOT_FOUND", "Table not found", 404);
      }

      const table = tableResult.rows[0];

      // Get active orders for this table
      const activeOrdersResult = await executeQuery(
        `SELECT id, "orderNumber", status, "paymentStatus", "paymentMethod", "customerName", 
                "totalAmount", "finalAmount", "createdAt", "orderSource"
         FROM orders 
         WHERE "tableNumber" = $1 AND "tenantId" = $2 AND status = 'active'
         ORDER BY "createdAt" ASC`,
        [tableId, tenantId]
      );

      const activeOrders = activeOrdersResult.rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        totalAmount: parseFloat(order.totalAmount?.toString() || "0"),
        finalAmount: parseFloat(order.finalAmount?.toString() || "0"),
        createdAt: order.createdAt,
        orderSource: order.orderSource,
      }));

      // Calculate table totals
      const totalAmount = activeOrders.reduce(
        (sum, order) => sum + order.finalAmount,
        0
      );
      const unpaidOrders = activeOrders.filter(
        (order) => order.paymentStatus !== "paid"
      );
      const paidOrders = activeOrders.filter(
        (order) => order.paymentStatus === "paid"
      );

      const tableStatus = {
        tableId: table.id,
        tableName: table.name,
        tableNumber: table.number,
        isActive: activeOrders.length > 0,
        activeOrdersCount: activeOrders.length,
        totalAmount,
        unpaidOrdersCount: unpaidOrders.length,
        paidOrdersCount: paidOrders.length,
        activeOrders,
        lastOrderAt:
          activeOrders.length > 0
            ? activeOrders[activeOrders.length - 1].createdAt
            : null,
      };

      logger.info(
        `📊 Table ${tableId} status: ${activeOrders.length} active orders, $${totalAmount} total`
      );
      sendSuccess(res, { tableStatus });
    } catch (error) {
      logger.error("Get table status error:", error);
      sendError(res, "GET_TABLE_STATUS_ERROR", "Failed to get table status");
    }
  }
);

export default router;
