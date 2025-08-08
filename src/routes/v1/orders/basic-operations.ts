import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
import {
  formatOrderFromRows,
  formatOrdersFromRows,
  generateOrderId,
  generateOrderNumber,
  generateItemId,
  getOrderWithItemsQuery,
} from "./helpers/order-formatters";
import {
  validateTableExists,
  validateMenuItemExists,
  validateOrderExists,
  mapOrderSource,
} from "./helpers/validation";
import { emitNewOrderEvent } from "./helpers/websocket-events";

const router = Router();

// GET /api/orders - Get all orders
router.get(
  "/",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { status, tableId } = req.query;

      let query = `
      SELECT o.*, 
             oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
             mi.name as menu_item_name,
             o."orderSource", o."sourceDetails", o."createdByUserId", o."createdByUserName",
             o."isDelivery", o."deliveryAddress", o."deliveryPlatform", o."deliveryOrderId",
             o."customerAddress", 
             o."estimatedDeliveryTime", o."specialInstructions",
             o."paymentStatus" as "paymentStatus", o."paymentMethod" as "paymentMethod", o."paidAt" as "paidAt",
             u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      LEFT JOIN users u ON o."createdById" = u.id
      WHERE o."tenantId" = $1
    `;
      const values: any[] = [tenantId];

      if (status) {
        query += ` AND o.status = $2`;
        values.push(status);
      }
      if (tableId) {
        query += ` AND o."tableNumber" = $${values.length + 1}`;
        values.push(tableId);
      }

      query += ` ORDER BY o."createdAt" DESC`;

      const result = await executeQuery(query, values);
      const formattedOrders = formatOrdersFromRows(result.rows);

      sendSuccess(res, { orders: formattedOrders });
    } catch (error) {
      logger.error("Get orders error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch orders");
    }
  }
);

// POST /api/orders - Create new order
router.post(
  "/",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const {
        tableId,
        items,
        orderSource,
        customerName,
        customerPhone,
        customerEmail,
        specialInstructions,
        isDelivery = false,
        deliveryAddress,
        deliveryPlatform,
        deliveryOrderId,
        estimatedDeliveryTime,
        priority = "normal",
        paymentMethod,
        taxAmount = 0,
        discountAmount = 0,
      } = req.body;

      if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Table ID and items array are required",
          400
        );
      }

      // Verify table exists
      if (!(await validateTableExists(tableId, tenantId, res))) {
        return;
      }

      // Calculate total and create order items
      let total = 0;
      const orderItems: any[] = [];

      for (const item of items) {
        const menuItem = await validateMenuItemExists(
          item.menuItemId,
          tenantId,
          res
        );
        if (!menuItem) return;

        const itemTotal = parseFloat(menuItem.price.toString()) * item.quantity;
        total += itemTotal;

        orderItems.push({
          quantity: item.quantity,
          unitPrice: menuItem.price,
          totalPrice: itemTotal,
          notes: item.notes || null,
          menuItemId: item.menuItemId,
        });
      }

      // Generate order number
      const orderNumber = generateOrderNumber();

      // Determine order source
      let finalOrderSource = mapOrderSource(orderSource || "WAITER");
      let sourceDetails = "";

      // Get user info for source details
      const user = (req as any).user;
      if (user) {
        const userName = `${user.firstName || ""} ${
          user.lastName || ""
        }`.trim();
        if (userName) {
          sourceDetails = userName;
        }
      }

      // Calculate final amount with tax and discount
      const finalAmount = total + taxAmount - discountAmount;

      // Create order
      const orderResult = await executeQuery(
        `INSERT INTO orders (
        id, "orderNumber", "tableNumber", "totalAmount", "taxAmount", "discountAmount", "finalAmount", 
        "tenantId", "createdById", status, "paymentStatus", "paymentMethod", "orderSource", "sourceDetails", 
        "customerName", "customerPhone", "notes", "isDelivery", "deliveryAddress", "deliveryPlatform", 
        "deliveryOrderId", "createdByUserId", "createdByUserName", "customerAddress", 
        "estimatedDeliveryTime", "specialInstructions", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) RETURNING *`,
        [
          generateOrderId(),
          orderNumber,
          tableId,
          total,
          taxAmount,
          discountAmount,
          finalAmount,
          tenantId,
          user?.id || null,
          "active", // Order is active and visible
          "pending", // Payment not yet processed
          null, // Payment method will be set when payment is taken
          finalOrderSource,
          sourceDetails,
          customerName || null,
          customerPhone || null,
          specialInstructions || null,
          isDelivery,
          deliveryAddress || null,
          deliveryPlatform || null,
          deliveryOrderId || null,
          user?.id || null,
          sourceDetails,
          deliveryAddress || null, // customerAddress
          estimatedDeliveryTime || null,
          specialInstructions || null,
          new Date(),
          new Date(),
        ]
      );

      const order = orderResult.rows[0];

      // Create order items
      for (const item of orderItems) {
        await executeQuery(
          `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            generateItemId(),
            order.id,
            item.menuItemId,
            item.quantity,
            item.unitPrice,
            item.totalPrice,
            item.notes,
            new Date(),
          ]
        );
      }

      // Get order with items for response
      const orderWithItemsResult = await executeQuery(
        `
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o.id = $1
    `,
        [order.id]
      );

      const formattedOrder = formatOrderFromRows(orderWithItemsResult.rows);

      // Emit WebSocket event for admin and kitchen staff only for active orders
      if (formattedOrder.status === "active") {
        emitNewOrderEvent(tenantId, formattedOrder);
      } else {
        logger.info(
          `Order ${formattedOrder.orderNumber} created with status ${formattedOrder.status} - WebSocket notification will be sent when order becomes active`
        );
      }

      logger.info(
        `Order created: ${order.orderNumber} by ${sourceDetails} via ${finalOrderSource}`
      );
      sendSuccess(
        res,
        { order: formattedOrder },
        "Order created successfully",
        201
      );
    } catch (error) {
      logger.error("Create order error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create order");
    }
  }
);

// PUT /api/orders/:id - Update order status
router.put(
  "/:id",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { status } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!status) {
        return sendError(res, "VALIDATION_ERROR", "Status is required", 400);
      }

      // Validate status values - Simplified to 3 states
      const validStatuses = ["active", "closed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Invalid status value. Use: active, closed, cancelled",
          400
        );
      }

      // Check if order exists
      const existingOrder = await validateOrderExists(id, tenantId, res);
      if (!existingOrder) return;

      // Update order status
      const orderResult = await executeQuery(
        'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE id = $3 RETURNING *',
        [status.toUpperCase(), new Date(), id]
      );

      const order = orderResult.rows[0];

      // Get order with items for response
      const orderWithItemsResult = await executeQuery(
        getOrderWithItemsQuery(),
        [order.id]
      );

      const formattedOrder = formatOrderFromRows(orderWithItemsResult.rows);

      logger.info(`Order status updated: ${order.orderNumber} - ${status}`);
      sendSuccess(
        res,
        { order: formattedOrder },
        "Order status updated successfully"
      );
    } catch (error) {
      logger.error("Update order status error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update order status");
    }
  }
);

// PUT /api/orders/:id/items/:itemId - Update specific item status
router.put(
  "/:id/items/:itemId",
  authenticateToken,
  requireRole(["KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id, itemId } = req.params;
      const { status } = req.body;

      if (!id || !itemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Order ID and Item ID are required",
          400
        );
      }

      if (!status) {
        return sendError(res, "VALIDATION_ERROR", "Status is required", 400);
      }

      // Validate status values - Simplified to 3 states
      const validStatuses = ["active", "closed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Invalid status value. Use: active, closed, cancelled",
          400
        );
      }

      // Check if order and item exist
      const orderItemResult = await executeQuery(
        `SELECT oi.*, o."tenantId" as order_tenant_id, mi.name as menu_item_name
       FROM "orderItems" oi 
       LEFT JOIN orders o ON oi."orderId" = o.id
       LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
       WHERE oi.id = $1 AND oi."orderId" = $2`,
        [itemId, id]
      );

      if (
        orderItemResult.rows.length === 0 ||
        orderItemResult.rows[0].order_tenant_id !== tenantId
      ) {
        return sendError(res, "NOT_FOUND", "Order item not found", 404);
      }

      const orderItem = orderItemResult.rows[0];

      // Since item status is not in current schema, we'll just return the item with updated status
      const formattedItem = {
        id: orderItem.id,
        menuItemId: orderItem.menuItemId,
        menuItemName: orderItem.menu_item_name,
        quantity: orderItem.quantity,
        price: parseFloat(orderItem.unitPrice.toString()),
        notes: orderItem.notes,
        status: status,
      };

      logger.info(`Order item status updated: ${itemId} - ${status}`);
      sendSuccess(
        res,
        { item: formattedItem },
        "Order item status updated successfully"
      );
    } catch (error) {
      logger.error("Update order item status error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update order item status");
    }
  }
);

// DELETE /api/orders/:id - Cancel order with reason
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { reason, cancelledBy } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!reason) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Cancellation reason is required",
          400
        );
      }

      // Check if order exists
      const existingOrder = await validateOrderExists(id, tenantId, res);
      if (!existingOrder) return;

      const user = (req as any).user;

      // Update order status to cancelled with reason
      await executeQuery(
        `UPDATE orders SET 
        status = $1, 
        "cancellationReason" = $2, 
        "cancelledByUserId" = $3, 
        "cancelledAt" = $4, 
        "updatedAt" = $5 
       WHERE id = $6`,
        [
          "CANCELLED",
          reason,
          user?.id || cancelledBy,
          new Date(),
          new Date(),
          id,
        ]
      );

      logger.info(`Order cancelled: ${id} - Reason: ${reason}`);
      sendSuccess(res, { success: true }, "Order cancelled successfully");
    } catch (error) {
      logger.error("Cancel order error:", error);
      sendError(res, "DELETE_ERROR", "Failed to cancel order");
    }
  }
);

export default router;
