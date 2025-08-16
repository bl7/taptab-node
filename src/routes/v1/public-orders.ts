import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getPublicTenantId } from "../../middleware/tenant";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";
import { OrderService } from "../../services/OrderService";
import { formatOrderFromRows } from "./orders/helpers/order-formatters";

const router = Router();

// ==================== PUBLIC ORDERS (QR Ordering) ====================

// POST /api/v1/public/orders - Create new order (PUBLIC - no auth required)
router.post("/", async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);
    const { tableNumber, items, customerName, customerPhone } = req.body;

    // Validate required fields
    if (!tableNumber || !items || !Array.isArray(items) || items.length === 0) {
      return sendError(
        res,
        "VALIDATION_ERROR",
        "Table number and items array are required",
        400
      );
    }

    // Verify table exists
    const tableResult = await executeQuery(
      'SELECT * FROM tables WHERE number = $1 AND "tenantId" = $2',
      [tableNumber, tenantId]
    );

    if (tableResult.rows.length === 0) {
      return sendError(res, "TABLE_NOT_FOUND", "Table not found", 400);
    }

    const table = tableResult.rows[0];

    // Verify all menu items exist and get their prices
    const orderItems = [];
    for (const item of items) {
      const menuItemResult = await executeQuery(
        'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
        [item.menuItemId, tenantId]
      );

      if (menuItemResult.rows.length === 0) {
        return sendError(
          res,
          "MENU_ITEM_NOT_FOUND",
          `Menu item ${item.menuItemId} not found`,
          400
        );
      }

      const menuItem = menuItemResult.rows[0];
      orderItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: parseFloat(menuItem.price.toString()),
        notes: item.notes || "",
      });
    }

    // Create order using service
    if (!tenantId) {
      return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
    }

    const orderData = {
      customerName: customerName || "Walk-in Customer",
      customerPhone: customerPhone || "",
      tableNumber: table.number, // Store the actual table number
      tenantId,
      orderItems,
      orderSource: "QR_ORDERING",
      sourceDetails: customerName || "QR Customer",
    };

    const formattedOrder = await OrderService.createOrder(orderData);

    logger.info(
      `Public order created: ${formattedOrder.orderNumber} for table ${tableNumber}`
    );
    sendSuccess(
      res,
      { order: formattedOrder },
      "Order created successfully",
      201
    );
  } catch (error) {
    logger.error("Create public order error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "CREATE_ERROR", "Failed to create order");
    }
  }
});

// GET /api/v1/public/orders/:orderId - Get order status (PUBLIC - no auth required)
router.get("/:orderId", async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);
    const { orderId } = req.params;

    const orderResult = await executeQuery(
      `
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o.id = $1 AND o."tenantId" = $2
    `,
      [orderId, tenantId]
    );

    if (orderResult.rows.length === 0) {
      return sendError(res, "ORDER_NOT_FOUND", "Order not found", 404);
    }

    const formattedOrder = formatOrderFromRows(orderResult.rows);

    sendSuccess(res, { order: formattedOrder });
  } catch (error) {
    logger.error("Get public order error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch order");
    }
  }
});

export default router;
