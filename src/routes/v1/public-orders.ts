import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getPublicTenantId } from "../../middleware/tenant";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";
import { socketManager } from "../../utils/socket";

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

    // Verify all menu items exist
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
    }

    // Create order
    const orderId = `order_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const orderNumber = `ORD-${Date.now()}`;

    const orderData = {
      id: orderId,
      orderNumber,
      tableNumber: table.id, // Store the table ID (UUID) in tableNumber column
      totalAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      finalAmount: 0,
      tenantId,
      createdById: null, // Public order, no user
      status: "pending", // Order starts as pending - will be activated after payment
      paymentStatus: "pending", // Payment not yet processed
      paymentMethod: null, // Will be set when payment is confirmed
      orderSource: "QR_ORDERING", // Always visible on table when active
      sourceDetails: customerName || "QR Customer",
      customerName: customerName || "Walk-in Customer",
      customerPhone: customerPhone || "",
      createdByUserId: null, // Public order, no user
      createdByUserName: customerName || "QR Customer",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Calculate totals
    let totalAmount = 0;
    for (const item of items) {
      const menuItem = await executeQuery(
        'SELECT price FROM "menuItems" WHERE id = $1',
        [item.menuItemId]
      );
      const price = parseFloat(menuItem.rows[0].price.toString());
      const itemTotal = price * item.quantity;
      totalAmount += itemTotal;
    }

    orderData.totalAmount = totalAmount;
    orderData.finalAmount = totalAmount;

    // Insert order
    const orderFields = Object.keys(orderData);
    const orderValues = Object.values(orderData);
    const orderPlaceholders = orderValues
      .map((_, index) => `$${index + 1}`)
      .join(", ");
    const orderFieldNames = orderFields.map((field) => `"${field}"`).join(", ");

    const insertOrderQuery = `INSERT INTO orders (${orderFieldNames}) VALUES (${orderPlaceholders}) RETURNING *`;
    logger.info(`🔍 Inserting order with status: ${orderData.status}`);
    logger.info(`🔍 Order data:`, orderData);
    const orderResult = await executeQuery(insertOrderQuery, orderValues);
    const order = orderResult.rows[0];
    logger.info(`🔍 Order created with status: ${order.status}`);

    // Create order items
    for (const item of items) {
      const menuItem = await executeQuery(
        'SELECT price FROM "menuItems" WHERE id = $1',
        [item.menuItemId]
      );
      const price = parseFloat(menuItem.rows[0].price.toString());
      const itemTotal = price * item.quantity;

      const orderItemData = {
        id: `oi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        orderId: order.id,
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: price,
        totalPrice: itemTotal,
        notes: item.notes || "",
        createdAt: new Date(),
      };

      const itemFields = Object.keys(orderItemData);
      const itemValues = Object.values(orderItemData);
      const itemPlaceholders = itemValues
        .map((_, index) => `$${index + 1}`)
        .join(", ");
      const itemFieldNames = itemFields.map((field) => `"${field}"`).join(", ");

      const insertItemQuery = `INSERT INTO "orderItems" (${itemFieldNames}) VALUES (${itemPlaceholders})`;
      await executeQuery(insertItemQuery, itemValues);
    }

    // Note: Multiple orders can be placed on the same table
    // No need to update table status or currentOrderId

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

    const orderRows = orderWithItemsResult.rows;
    logger.info(`🔍 Retrieved order status from DB: ${orderRows[0].status}`);
    const formattedOrder = {
      id: orderRows[0].id,
      orderNumber: orderRows[0].orderNumber,
      tableId: orderRows[0].tableId,
      totalAmount: parseFloat(orderRows[0].totalAmount.toString()),
      finalAmount: parseFloat(orderRows[0].finalAmount.toString()),
      status: orderRows[0].status,
      customerName: orderRows[0].customerName,
      customerPhone: orderRows[0].customerPhone,
      items: orderRows
        .filter((row) => row.item_id)
        .map((row) => ({
          id: row.item_id,
          menuItemId: row.menuItemId,
          menuItemName: row.menu_item_name,
          quantity: row.quantity,
          price: parseFloat(row.unitPrice.toString()),
          total: parseFloat(row.totalPrice.toString()),
          notes: row.notes,
        })),
      createdAt: orderRows[0].createdAt,
      updatedAt: orderRows[0].updatedAt,
    };

    // Emit WebSocket event for admin and kitchen staff only for active orders
    // pending orders will be emitted when payment is confirmed and status changes to active
    if (formattedOrder.status === "active") {
      try {
        socketManager.emitNewOrder(tenantId, formattedOrder);
      } catch (error) {
        logger.error("Failed to emit WebSocket event:", error);
        // Don't fail the order creation if WebSocket fails
      }
    } else {
      logger.info(
        `Order ${formattedOrder.orderNumber} created with status ${formattedOrder.status} - WebSocket notification will be sent when payment is confirmed and order becomes active`
      );
    }

    logger.info(
      `Public order created: ${order.orderNumber} for table ${tableNumber}`
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

    const orderRows = orderResult.rows;
    const formattedOrder = {
      id: orderRows[0].id,
      orderNumber: orderRows[0].orderNumber,
      tableId: orderRows[0].tableId,
      totalAmount: parseFloat(orderRows[0].totalAmount.toString()),
      finalAmount: parseFloat(orderRows[0].finalAmount.toString()),
      status: orderRows[0].status,
      customerName: orderRows[0].customerName,
      customerPhone: orderRows[0].customerPhone,
      items: orderRows
        .filter((row) => row.item_id)
        .map((row) => ({
          id: row.item_id,
          menuItemId: row.menuItemId,
          menuItemName: row.menu_item_name,
          quantity: row.quantity,
          price: parseFloat(row.unitPrice.toString()),
          total: parseFloat(row.totalPrice.toString()),
          notes: row.notes,
        })),
      createdAt: orderRows[0].createdAt,
      updatedAt: orderRows[0].updatedAt,
    };

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
