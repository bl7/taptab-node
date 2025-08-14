import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// GET /api/v1/debug/tenants - Debug all tenants
router.get(
  "/tenants",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      logger.info(`🔍 Debugging all tenants`);

      // Get all tenants
      const tenantsResult = await executeQuery(
        `SELECT id, name, slug, "isActive", "createdAt" FROM tenants ORDER BY "createdAt" DESC`
      );

      const tenants = tenantsResult.rows.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
      }));

      logger.info(`📊 Found ${tenants.length} tenants:`, tenants);

      sendSuccess(res, {
        tenants,
        count: tenants.length,
        debug: {
          currentUserTenantId: (req as any).user?.tenantId,
          currentUserEmail: (req as any).user?.email,
        },
      });
    } catch (error) {
      logger.error("❌ Error debugging tenants:", error);
      sendError(res, "DEBUG_ERROR", "Failed to debug tenants", 500);
    }
  }
);

// GET /api/v1/debug/order/:orderId - Debug order status and details
router.get(
  "/order/:orderId",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const tenantId = getTenantId(req);

      logger.info(`🔍 Debugging order: ${orderId} for tenant: ${tenantId}`);

      // Get order details
      const orderResult = await executeQuery(
        `
        SELECT o.*, 
               op.status as payment_status,
               op.payment_intent_id,
               op.amount as payment_amount,
               op.payment_method as payment_method
        FROM orders o
        LEFT JOIN order_payments op ON o.id = op.order_id
        WHERE o.id = $1 AND o."tenantId" = $2
      `,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "ORDER_NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];

      // Get order items
      const itemsResult = await executeQuery(
        `
        SELECT oi.*, mi.name as menu_item_name
        FROM "orderItems" oi
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE oi."orderId" = $1
      `,
        [orderId]
      );

      const orderData = {
        id: order.id,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        paymentIntentId: order.payment_intent_id,
        paymentAmount: order.payment_amount,
        totalAmount: parseFloat(order.totalAmount.toString()),
        finalAmount: parseFloat(order.finalAmount.toString()),
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paidAt: order.paidAt,
        items: itemsResult.rows.map((item) => ({
          id: item.id,
          menuItemId: item.menuItemId,
          menuItemName: item.menu_item_name,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice.toString()),
          totalPrice: parseFloat(item.totalPrice.toString()),
          notes: item.notes,
        })),
      };

      logger.info(`📊 Order debug data:`, orderData);

      sendSuccess(res, {
        order: orderData,
        debug: {
          orderStatus: order.status,
          paymentStatus: order.payment_status,
          paymentMethod: order.payment_method,
          orderSource: order.orderSource,
          hasPaymentRecord: !!order.payment_intent_id,
          isActive: order.status === "active",
          isClosed: order.status === "closed",
          isCancelled: order.status === "cancelled",
          isPaid: order.payment_status === "paid",
          isPendingPayment: order.payment_status === "pending",
          isQROrder: order.orderSource === "QR_ORDERING",
          isVisibleOnTable:
            order.status === "active" &&
            (order.orderSource === "QR_ORDERING" ||
              (["WAITER", "CASHIER"].includes(order.orderSource) &&
                order.payment_status === "pending")),
        },
      });
    } catch (error) {
      logger.error("Debug order error:", error);
      sendError(res, "DEBUG_ERROR", "Failed to debug order");
    }
  }
);

// GET /api/v1/debug/orders/table/:tableNumber - Get all orders for a table
router.get(
  "/orders/table/:tableNumber",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const { tableNumber } = req.params;
      const tenantId = getTenantId(req);

      logger.info(
        `🔍 Debugging orders for table: ${tableNumber} in tenant: ${tenantId}`
      );

      // Get all orders for this table
      const ordersResult = await executeQuery(
        `
        SELECT o.*, 
               op.status as payment_status,
               op.payment_intent_id,
               op.amount as payment_amount,
               op.payment_method as payment_method
        FROM orders o
        LEFT JOIN order_payments op ON o.id = op.order_id
        WHERE o."tableNumber" = $1 AND o."tenantId" = $2
        ORDER BY o."createdAt" DESC
      `,
        [tableNumber, tenantId]
      );

      const orders = ordersResult.rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        totalAmount: parseFloat(order.totalAmount.toString()),
        finalAmount: parseFloat(order.finalAmount.toString()),
        customerName: order.customerName,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paidAt: order.paidAt,
      }));

      logger.info(
        `📊 Found ${orders.length} orders for table ${tableNumber}:`,
        orders
      );

      sendSuccess(res, {
        tableNumber,
        orders,
        summary: {
          totalOrders: orders.length,
          activeOrders: orders.filter((o) => o.status === "active").length,
          pendingOrders: orders.filter((o) => o.status === "pending").length,
          paidOrders: orders.filter((o) => o.paymentStatus === "confirmed")
            .length,
        },
      });
    } catch (error) {
      logger.error("Debug table orders error:", error);
      sendError(res, "DEBUG_ERROR", "Failed to debug table orders");
    }
  }
);

// GET /api/v1/debug/order/:orderId/raw - Get raw order data from database
router.get(
  "/order/:orderId/raw",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const tenantId = getTenantId(req);

      logger.info(
        `🔍 Debugging raw order data: ${orderId} for tenant: ${tenantId}`
      );

      // Get raw order data
      const orderResult = await executeQuery(
        `SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "ORDER_NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];

      // Get all column names
      const columnNames = Object.keys(order);

      sendSuccess(res, {
        order: order,
        columnNames: columnNames,
        hasPaymentStatus: "paymentStatus" in order,
        hasPaymentMethod: "paymentMethod" in order,
        paymentStatusValue: order.paymentStatus,
        paymentMethodValue: order.paymentMethod,
      });
    } catch (error) {
      logger.error("Debug raw order error:", error);
      sendError(res, "DEBUG_ERROR", "Failed to debug raw order");
    }
  }
);

export default router;
