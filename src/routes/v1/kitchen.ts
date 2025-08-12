import express, { Request, Response } from "express";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { getTenantId } from "../../middleware/tenant";
import { executeQuery } from "../../utils/database";
import { sendSuccess, sendError } from "../../utils/response";
import { logger } from "../../utils/logger";

const router = express.Router();

// GET /api/v1/kitchen/orders - Get all active orders for kitchen
router.get(
  "/orders",
  authenticateToken,
  requireRole(["KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { status } = req.query;

      // Build query based on status filter
      let query = `
        SELECT DISTINCT o.id, o."orderNumber", o."tableNumber", o.status as order_status, 
               o."createdAt", o."customerName", o."customerPhone",
               COUNT(oi.id) as total_items,
               COUNT(CASE WHEN oi.status = 'pending' THEN 1 END) as pending_items,
               COUNT(CASE WHEN oi.status = 'cooked' THEN 1 END) as cooked_items
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        WHERE o."tenantId" = $1 AND o.status = 'active'
      `;

      const queryParams = [tenantId];

      if (status && status !== "all") {
        query += ` AND oi.status = $2`;
        queryParams.push(status as string);
      }

      query += ` GROUP BY o.id, o."orderNumber", o."tableNumber", o.status, o."createdAt", o."customerName", o."customerPhone"
                 ORDER BY o."createdAt" DESC`;

      const ordersResult = await executeQuery(query, queryParams);

      const formattedOrders = ordersResult.rows.map((order: any) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        orderStatus: order.order_status,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        createdAt: order.createdAt,
        itemCounts: {
          total: parseInt(order.total_items),
          pending: parseInt(order.pending_items),
          cooked: parseInt(order.cooked_items),
        },
      }));

      logger.info(`Kitchen retrieved ${formattedOrders.length} active orders`);
      sendSuccess(
        res,
        { orders: formattedOrders },
        "Kitchen orders retrieved successfully"
      );
    } catch (error) {
      logger.error("Kitchen get orders error:", error);
      sendError(res, "FETCH_ERROR", "Failed to retrieve kitchen orders");
    }
  }
);

// GET /api/v1/kitchen/orders/:orderId - Get detailed order with items for kitchen
router.get(
  "/orders/:orderId",
  authenticateToken,
  requireRole(["KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;

      if (!orderId) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      // Get order details
      const orderResult = await executeQuery(
        `SELECT o.*, 
                COUNT(oi.id) as total_items,
                COUNT(CASE WHEN oi.status = 'pending' THEN 1 END) as pending_items,
                COUNT(CASE WHEN oi.status = 'cooked' THEN 1 END) as cooked_items
         FROM orders o
         LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
         WHERE o.id = $1 AND o."tenantId" = $2
         GROUP BY o.id`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];

      // Get order items with menu item details
      const itemsResult = await executeQuery(
        `SELECT oi.*, mi.name as menu_item_name, mi.description as menu_item_description,
                c.name as category_name
         FROM "orderItems" oi
         LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
         LEFT JOIN categories c ON mi."categoryId" = c.id
         WHERE oi."orderId" = $1
         ORDER BY oi."createdAt" ASC`,
        [orderId]
      );

      const formattedOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        status: order.status,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        createdAt: order.createdAt,
        itemCounts: {
          total: parseInt(order.total_items),
          pending: parseInt(order.pending_items),
          cooked: parseInt(order.cooked_items),
        },
        items: itemsResult.rows.map((item: any) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          menuItemName: item.menu_item_name,
          menuItemDescription: item.menu_item_description,
          categoryName: item.category_name,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice.toString()),
          totalPrice: parseFloat(item.totalPrice.toString()),
          notes: item.notes,
          status: item.status,
          createdAt: item.createdAt,
        })),
      };

      logger.info(`Kitchen retrieved order details: ${order.orderNumber}`);
      sendSuccess(
        res,
        { order: formattedOrder },
        "Order details retrieved successfully"
      );
    } catch (error) {
      logger.error("Kitchen get order details error:", error);
      sendError(res, "FETCH_ERROR", "Failed to retrieve order details");
    }
  }
);

// PUT /api/v1/kitchen/orders/:orderId/items/:itemId/status - Update item cooking status
router.put(
  "/orders/:orderId/items/:itemId/status",
  authenticateToken,
  requireRole(["KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { orderId, itemId } = req.params;
      const { status, notes } = req.body;

      if (!orderId || !itemId) {
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

      // Validate kitchen-specific status values
      const validStatuses = ["pending", "cooked", "ready", "active"];
      if (!validStatuses.includes(status)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid status value: "${status}". Valid values are: ${validStatuses.join(
            ", "
          )}`,
          400
        );
      }

      // Map frontend status to database status
      let dbStatus = status;
      if (status === "ready") {
        dbStatus = "cooked";
      } else if (status === "active") {
        dbStatus = "pending";
      }

      // Check if order and item exist and belong to tenant
      const orderItemResult = await executeQuery(
        `SELECT oi.*, o."tenantId" as order_tenant_id, o."orderNumber", 
                mi.name as menu_item_name
         FROM "orderItems" oi 
         LEFT JOIN orders o ON oi."orderId" = o.id
         LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
         WHERE oi.id = $1 AND oi."orderId" = $2`,
        [itemId, orderId]
      );

      if (
        orderItemResult.rows.length === 0 ||
        orderItemResult.rows[0].order_tenant_id !== tenantId
      ) {
        return sendError(res, "NOT_FOUND", "Order item not found", 404);
      }

      const orderItem = orderItemResult.rows[0];

      // Update the order item status
      const updateFields = ["status = $1"];
      const updateValues = [dbStatus];
      let paramIndex = 2;

      if (notes !== undefined) {
        updateFields.push(`notes = $${paramIndex}`);
        updateValues.push(notes);
        paramIndex++;
      }

      updateFields.push(`"updatedAt" = $${paramIndex}`);
      updateValues.push(new Date());
      paramIndex++;

      updateValues.push(itemId);

      await executeQuery(
        `UPDATE "orderItems" SET ${updateFields.join(
          ", "
        )} WHERE id = $${paramIndex}`,
        updateValues
      );

      // Get the updated item
      const updatedItemResult = await executeQuery(
        `SELECT oi.*, mi.name as menu_item_name
         FROM "orderItems" oi 
         LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
         WHERE oi.id = $1`,
        [itemId]
      );

      const updatedItem = updatedItemResult.rows[0];

      const formattedItem = {
        id: updatedItem.id,
        menuItemId: updatedItem.menuItemId,
        menuItemName: updatedItem.menu_item_name,
        quantity: updatedItem.quantity,
        unitPrice: parseFloat(updatedItem.unitPrice.toString()),
        totalPrice: parseFloat(updatedItem.totalPrice.toString()),
        notes: updatedItem.notes,
        status: updatedItem.status,
        updatedAt: updatedItem.updatedAt,
      };

      logger.info(
        `Kitchen updated item status: ${itemId} - ${status} for order ${orderItem.orderNumber}`
      );
      sendSuccess(
        res,
        {
          item: formattedItem,
          message: `Item status updated to ${status}`,
        },
        "Item status updated successfully"
      );
    } catch (error) {
      logger.error("Kitchen update item status error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update item status");
    }
  }
);

// GET /api/v1/kitchen/dashboard - Get kitchen dashboard overview
router.get(
  "/dashboard",
  authenticateToken,
  requireRole(["KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Get kitchen statistics
      const statsResult = await executeQuery(
        `SELECT 
           COUNT(DISTINCT o.id) as active_orders,
           COUNT(CASE WHEN oi.status = 'pending' THEN 1 END) as pending_items,
           COUNT(CASE WHEN oi.status = 'cooked' THEN 1 END) as cooked_items
         FROM orders o
         LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
         WHERE o."tenantId" = $1 AND o.status = 'active'`,
        [tenantId]
      );

      const stats = statsResult.rows[0];

      // Get recent orders that need attention
      const recentOrdersResult = await executeQuery(
        `SELECT DISTINCT o.id, o."orderNumber", o."tableNumber", o."createdAt",
                COUNT(CASE WHEN oi.status = 'pending' THEN 1 END) as pending_count
         FROM orders o
         LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
         WHERE o."tenantId" = $1 AND o.status = 'active'
           AND oi.status = 'pending'
         GROUP BY o.id, o."orderNumber", o."tableNumber", o."createdAt"
         ORDER BY o."createdAt" ASC
         LIMIT 10`,
        [tenantId]
      );

      const dashboard = {
        statistics: {
          activeOrders: parseInt(stats.active_orders),
          pendingItems: parseInt(stats.pending_items),
          cookedItems: parseInt(stats.cooked_items),
        },
        recentOrders: recentOrdersResult.rows.map((order: any) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          createdAt: order.createdAt,
          pendingCount: parseInt(order.pending_count),
        })),
      };

      logger.info(`Kitchen dashboard retrieved for tenant: ${tenantId}`);
      sendSuccess(
        res,
        { dashboard },
        "Kitchen dashboard retrieved successfully"
      );
    } catch (error) {
      logger.error("Kitchen dashboard error:", error);
      sendError(res, "FETCH_ERROR", "Failed to retrieve kitchen dashboard");
    }
  }
);

export default router;
