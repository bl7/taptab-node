import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError, sendNotFound } from "../../utils/response";
import { executeQuery } from "../../utils/database";
import { socketManager } from "../../utils/socket";

const router = Router();

// ==================== ORDERS MANAGEMENT ====================

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
      const rows = result.rows;

      // Group orders and their items
      const ordersMap = new Map();
      rows.forEach((row: any) => {
        if (!ordersMap.has(row.id)) {
          ordersMap.set(row.id, {
            id: row.id,
            tableId: row.tableNumber,
            tableNumber: row.tableNumber,
            items: [],
            total: parseFloat(row.finalAmount.toString()),
            status: row.status.toLowerCase(),
            waiterId: row.createdById,
            waiterName:
              row.createdByUserName ||
              row.sourceDetails ||
              (row.waiter_first_name && row.waiter_last_name
                ? `${row.waiter_first_name} ${row.waiter_last_name}`
                : "Unknown"),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            orderSource: row.orderSource,
            sourceDetails: row.sourceDetails,
            createdByUserId: row.createdByUserId,
            createdByUserName: row.createdByUserName,
            customerName: row.customerName,
            customerPhone: row.customerPhone,
            customerEmail: row.customerEmail,
            specialInstructions: row.specialInstructions,
            isDelivery: row.isDelivery,
            deliveryAddress: row.deliveryAddress,
            deliveryPlatform: row.deliveryPlatform,
            deliveryOrderId: row.deliveryOrderId,
            estimatedDeliveryTime: row.estimatedDeliveryTime,
            taxAmount: parseFloat(row.taxAmount.toString()),
            discountAmount: parseFloat(row.discountAmount.toString()),
          });
        }

        if (row.item_id) {
          ordersMap.get(row.id).items.push({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          });
        }
      });

      const formattedOrders = Array.from(ordersMap.values());

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
          "TableId and items array are required",
          400
        );
      }

      // Verify table exists (check both number and id)
      const tableResult = await executeQuery(
        'SELECT * FROM tables WHERE (number = $1 OR id = $1) AND "tenantId" = $2',
        [tableId, tenantId]
      );

      if (tableResult.rows.length === 0) {
        return sendError(
          res,
          "TABLE_NOT_FOUND",
          `Table ${tableId} not found`,
          400
        );
      }

      // Calculate total and create order items
      let total = 0;
      const orderItems: any[] = [];

      for (const item of items) {
        const menuItemResult = await executeQuery(
          'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
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
      const orderNumber = `ORD-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 5)}`;

      // Determine order source
      let finalOrderSource = orderSource || "WAITER";
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

      // Map order source to appropriate value
      switch (finalOrderSource.toUpperCase()) {
        case "QR":
          finalOrderSource = "QR_ORDERING";
          break;
        case "WAITER":
          finalOrderSource = "WAITER_ORDERING";
          break;
        case "CASHIER":
          finalOrderSource = "CASHIER_ORDERING";
          break;
        case "MANAGER":
          finalOrderSource = "MANAGER_ORDERING";
          break;
        default:
          finalOrderSource = "WAITER_ORDERING";
      }

      // Calculate final amount with tax and discount
      const finalAmount = total + taxAmount - discountAmount;

      // Create order
      const orderResult = await executeQuery(
        `INSERT INTO orders (
        id, "orderNumber", "tableNumber", "totalAmount", "taxAmount", "discountAmount", "finalAmount", 
        "tenantId", "createdById", status, "orderSource", "sourceDetails", 
        "customerName", "customerPhone", "notes", "isDelivery", "deliveryAddress", "deliveryPlatform", 
        "deliveryOrderId", "createdByUserId", "createdByUserName", "customerAddress", 
        "estimatedDeliveryTime", "specialInstructions", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING *`,
        [
          `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          orderNumber,
          tableId,
          total,
          taxAmount,
          discountAmount,
          finalAmount,
          tenantId,
          user?.id || null,
          "ACTIVE",
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
            `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
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

      // Get order with items for response (same as public orders)
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
      const formattedOrder = {
        id: order.id,
        tableId: order.tableNumber,
        tableNumber: order.tableNumber,
        items: orderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(order.finalAmount.toString()),
        status: order.status.toLowerCase(),
        waiterId: order.createdById,
        waiterName: sourceDetails || "Unknown",
        orderSource: order.orderSource,
        sourceDetails: order.sourceDetails,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        notes: order.notes,
        specialInstructions: order.specialInstructions,
        isDelivery: order.isDelivery,
        deliveryAddress: order.deliveryAddress,
        deliveryPlatform: order.deliveryPlatform,
        deliveryOrderId: order.deliveryOrderId,
        customerAddress: order.customerAddress,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        taxAmount: parseFloat(order.taxAmount.toString()),
        discountAmount: parseFloat(order.discountAmount.toString()),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      };

      // Emit WebSocket event for admin and kitchen staff
      try {
        socketManager.emitNewOrder(tenantId, formattedOrder);
      } catch (error) {
        logger.error("Failed to emit WebSocket event:", error);
        // Don't fail the order creation if WebSocket fails
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

// PUT /api/orders/:id/modify - Modify order (add/remove items)
router.put(
  "/:id/modify",
  authenticateToken,
  requireRole(["WAITER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      logger.info("=== MODIFY ORDER ROUTE CALLED ===");
      logger.info(`Request params: ${JSON.stringify(req.params)}`);
      logger.info(`Request body: ${JSON.stringify(req.body)}`);

      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { action, itemId, quantity, notes, reason } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!action || !itemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Action and itemId are required",
          400
        );
      }

      // Check if order exists
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      // Check if menu item exists
      const menuItemResult = await executeQuery(
        'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
        [itemId, tenantId]
      );

      if (menuItemResult.rows.length === 0) {
        return sendError(
          res,
          "MENU_ITEM_NOT_FOUND",
          "Menu item not found",
          400
        );
      }

      const menuItem = menuItemResult.rows[0];
      const user = (req as any).user;

      if (action === "add_item") {
        // Add new item to order
        const itemTotal = parseFloat(menuItem.price.toString()) * quantity;

        await executeQuery(
          `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            id,
            itemId,
            quantity,
            menuItem.price,
            itemTotal,
            notes,
            new Date(),
          ]
        );

        // Update order total
        const currentTotal = parseFloat(
          existingOrderResult.rows[0].totalAmount.toString()
        );
        const newTotal = currentTotal + itemTotal;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newTotal, newTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          `
        SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name,
               u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        LEFT JOIN users u ON o."createdById" = u.id
        WHERE o.id = $1
      `,
          [id]
        );

        const updatedOrderRows = updatedOrderResult.rows;
        const updatedFormattedOrder = {
          id: updatedOrderRows[0].id,
          tableId: updatedOrderRows[0].tableNumber,
          tableNumber: updatedOrderRows[0].tableNumber,
          items: updatedOrderRows
            .filter((row) => row.item_id)
            .map((row) => ({
              id: row.item_id,
              menuItemId: row.menuItemId,
              menuItemName: row.menu_item_name,
              quantity: row.quantity,
              price: parseFloat(row.unitPrice.toString()),
              notes: row.notes,
              status: "active",
            })),
          total: parseFloat(updatedOrderRows[0].finalAmount.toString()),
          status: updatedOrderRows[0].status.toLowerCase(),
          waiterId: updatedOrderRows[0].createdById,
          waiterName:
            updatedOrderRows[0].createdByUserName ||
            updatedOrderRows[0].sourceDetails ||
            (updatedOrderRows[0].waiter_first_name &&
            updatedOrderRows[0].waiter_last_name
              ? `${updatedOrderRows[0].waiter_first_name} ${updatedOrderRows[0].waiter_last_name}`
              : "Unknown"),
          createdAt: updatedOrderRows[0].createdAt,
          updatedAt: updatedOrderRows[0].updatedAt,
        };

        // Emit receipt with added items
        try {
          const modifiedBy =
            user?.firstName && user?.lastName
              ? `${user.firstName} ${user.lastName}`
              : user?.id || "Unknown";

          logger.info(
            "Attempting to emit order modification receipt for add_item..."
          );
          socketManager.emitOrderModificationReceipt(
            tenantId,
            updatedFormattedOrder,
            {
              addedItems: [
                {
                  name: menuItem.name,
                  quantity: quantity,
                  price: parseFloat(menuItem.price.toString()),
                  notes: notes,
                },
              ],
              modificationType: "add",
              modifiedBy: modifiedBy,
              reason: reason,
            }
          );
          logger.info(
            "Successfully emitted order modification receipt for add_item"
          );
        } catch (error) {
          logger.error("Failed to emit WebSocket event:", error);
          // Don't fail the order modification if WebSocket fails
        }

        logger.info(
          `Item added to order: ${id} - Item: ${menuItem.name}, Quantity: ${quantity}`
        );
        sendSuccess(
          res,
          { success: true, action: "add_item", itemId, quantity },
          "Item added to order successfully"
        );
      } else if (action === "remove_item") {
        // Find the specific order item to remove
        const orderItemResult = await executeQuery(
          'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
          [id, itemId]
        );

        if (orderItemResult.rows.length === 0) {
          return sendError(
            res,
            "ITEM_NOT_FOUND",
            "Item not found in order",
            400
          );
        }

        const orderItem = orderItemResult.rows[0];
        const itemTotal = parseFloat(orderItem.totalPrice.toString());

        // Remove the item
        await executeQuery(
          'DELETE FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
          [id, itemId]
        );

        // Update order total
        const currentTotal = parseFloat(
          existingOrderResult.rows[0].totalAmount.toString()
        );
        const newTotal = currentTotal - itemTotal;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newTotal, newTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          `
        SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name,
               u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        LEFT JOIN users u ON o."createdById" = u.id
        WHERE o.id = $1
      `,
          [id]
        );

        const updatedOrderRows = updatedOrderResult.rows;
        const updatedFormattedOrder = {
          id: updatedOrderRows[0].id,
          tableId: updatedOrderRows[0].tableNumber,
          tableNumber: updatedOrderRows[0].tableNumber,
          items: updatedOrderRows
            .filter((row) => row.item_id)
            .map((row) => ({
              id: row.item_id,
              menuItemId: row.menuItemId,
              menuItemName: row.menu_item_name,
              quantity: row.quantity,
              price: parseFloat(row.unitPrice.toString()),
              notes: row.notes,
              status: "active",
            })),
          total: parseFloat(updatedOrderRows[0].finalAmount.toString()),
          status: updatedOrderRows[0].status.toLowerCase(),
          waiterId: updatedOrderRows[0].createdById,
          waiterName:
            updatedOrderRows[0].createdByUserName ||
            updatedOrderRows[0].sourceDetails ||
            (updatedOrderRows[0].waiter_first_name &&
            updatedOrderRows[0].waiter_last_name
              ? `${updatedOrderRows[0].waiter_first_name} ${updatedOrderRows[0].waiter_last_name}`
              : "Unknown"),
          createdAt: updatedOrderRows[0].createdAt,
          updatedAt: updatedOrderRows[0].updatedAt,
        };

        // Emit receipt with removed items
        try {
          const modifiedBy =
            user?.firstName && user?.lastName
              ? `${user.firstName} ${user.lastName}`
              : user?.id || "Unknown";

          logger.info(
            "Attempting to emit order modification receipt for remove_item..."
          );
          socketManager.emitOrderModificationReceipt(
            tenantId,
            updatedFormattedOrder,
            {
              removedItems: [
                {
                  name: menuItem.name,
                  quantity: orderItem.quantity,
                  price: parseFloat(orderItem.unitPrice.toString()),
                  reason: reason,
                },
              ],
              modificationType: "remove",
              modifiedBy: modifiedBy,
              reason: reason,
            }
          );
          logger.info(
            "Successfully emitted order modification receipt for remove_item"
          );
        } catch (error) {
          logger.error("Failed to emit WebSocket event:", error);
          // Don't fail the order modification if WebSocket fails
        }

        logger.info(`Item removed from order: ${id} - Item: ${menuItem.name}`);
        sendSuccess(
          res,
          { success: true, action: "remove_item", itemId },
          "Item removed from order successfully"
        );
      } else if (action === "change_quantity") {
        // Find the specific order item to update
        const orderItemResult = await executeQuery(
          'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
          [id, itemId]
        );

        if (orderItemResult.rows.length === 0) {
          return sendError(
            res,
            "ITEM_NOT_FOUND",
            "Item not found in order",
            400
          );
        }

        const orderItem = orderItemResult.rows[0];
        const oldTotal = parseFloat(orderItem.totalPrice.toString());
        const newTotal = parseFloat(menuItem.price.toString()) * quantity;

        // Update the item quantity and total
        await executeQuery(
          'UPDATE "orderItems" SET quantity = $1, "totalPrice" = $2, notes = $3 WHERE "orderId" = $4 AND "menuItemId" = $5',
          [quantity, newTotal, notes, id, itemId]
        );

        // Update order total
        const currentTotal = parseFloat(
          existingOrderResult.rows[0].totalAmount.toString()
        );
        const totalDifference = newTotal - oldTotal;
        const newOrderTotal = currentTotal + totalDifference;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newOrderTotal, newOrderTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          `
        SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name,
               u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        LEFT JOIN users u ON o."createdById" = u.id
        WHERE o.id = $1
      `,
          [id]
        );

        const updatedOrderRows = updatedOrderResult.rows;
        const updatedFormattedOrder = {
          id: updatedOrderRows[0].id,
          tableId: updatedOrderRows[0].tableNumber,
          tableNumber: updatedOrderRows[0].tableNumber,
          items: updatedOrderRows
            .filter((row) => row.item_id)
            .map((row) => ({
              id: row.item_id,
              menuItemId: row.menuItemId,
              menuItemName: row.menu_item_name,
              quantity: row.quantity,
              price: parseFloat(row.unitPrice.toString()),
              notes: row.notes,
              status: "active",
            })),
          total: parseFloat(updatedOrderRows[0].finalAmount.toString()),
          status: updatedOrderRows[0].status.toLowerCase(),
          waiterId: updatedOrderRows[0].createdById,
          waiterName:
            updatedOrderRows[0].createdByUserName ||
            updatedOrderRows[0].sourceDetails ||
            (updatedOrderRows[0].waiter_first_name &&
            updatedOrderRows[0].waiter_last_name
              ? `${updatedOrderRows[0].waiter_first_name} ${updatedOrderRows[0].waiter_last_name}`
              : "Unknown"),
          createdAt: updatedOrderRows[0].createdAt,
          updatedAt: updatedOrderRows[0].updatedAt,
        };

        // Emit receipt with modified items
        try {
          const modifiedBy =
            user?.firstName && user?.lastName
              ? `${user.firstName} ${user.lastName}`
              : user?.id || "Unknown";

          logger.info(
            "Attempting to emit order modification receipt for change_quantity..."
          );
          socketManager.emitOrderModificationReceipt(
            tenantId,
            updatedFormattedOrder,
            {
              modifiedItems: [
                {
                  name: menuItem.name,
                  oldQuantity: orderItem.quantity,
                  newQuantity: quantity,
                  price: parseFloat(menuItem.price.toString()),
                  notes: notes,
                },
              ],
              modificationType: "modify",
              modifiedBy: modifiedBy,
              reason: reason,
            }
          );
          logger.info(
            "Successfully emitted order modification receipt for change_quantity"
          );
        } catch (error) {
          logger.error("Failed to emit WebSocket event:", error);
          // Don't fail the order modification if WebSocket fails
        }

        logger.info(
          `Item quantity changed in order: ${id} - Item: ${menuItem.name}, New Quantity: ${quantity}`
        );
        sendSuccess(
          res,
          { success: true, action: "change_quantity", itemId, quantity },
          "Item quantity updated successfully"
        );
      } else {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Invalid action. Use: add_item, remove_item, change_quantity",
          400
        );
      }
    } catch (error) {
      logger.error("Modify order error:", error);
      sendError(res, "MODIFY_ERROR", "Failed to modify order");
    }
  }
);

// PUT /api/orders/:id/pay - Mark order as paid
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
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      const user = (req as any).user;

      // Update order payment status
      await executeQuery(
        `UPDATE orders SET 
        "paymentStatus" = $1, 
        "paymentMethod" = $2, 
        "paidByUserId" = $3, 
        "paidAt" = $4, 
        "updatedAt" = $5 
       WHERE id = $6`,
        ["PAID", paymentMethod, user?.id || paidBy, new Date(), new Date(), id]
      );

      // Get order with items for notification
      const orderWithItemsResult = await executeQuery(
        `
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name,
             u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      LEFT JOIN users u ON o."createdById" = u.id
      WHERE o.id = $1
    `,
        [id]
      );

      const orderRows = orderWithItemsResult.rows;
      const formattedOrder = {
        id: orderRows[0].id,
        tableId: orderRows[0].tableNumber,
        tableNumber: orderRows[0].tableNumber,
        items: orderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(orderRows[0].finalAmount.toString()),
        status: "paid",
        waiterId: orderRows[0].createdById,
        waiterName:
          orderRows[0].createdByUserName ||
          orderRows[0].sourceDetails ||
          (orderRows[0].waiter_first_name && orderRows[0].waiter_last_name
            ? `${orderRows[0].waiter_first_name} ${orderRows[0].waiter_last_name}`
            : "Unknown"),
        createdAt: orderRows[0].createdAt,
        updatedAt: orderRows[0].updatedAt,
      };

      // Emit WebSocket event for order payment
      try {
        const paidByUser =
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || paidBy || "Unknown";

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
      const validStatuses = ["active", "paid", "cancelled"];
      if (!validStatuses.includes(status)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Invalid status value. Use: active, paid, cancelled",
          400
        );
      }

      // Check if order exists
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      // Update order status
      const orderResult = await executeQuery(
        'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE id = $3 RETURNING *',
        [status.toUpperCase(), new Date(), id]
      );

      const order = orderResult.rows[0];

      // Get order with items for response (same as public orders)
      const orderWithItemsResult = await executeQuery(
        `
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name,
             u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      LEFT JOIN users u ON o."createdById" = u.id
      WHERE o.id = $1
    `,
        [order.id]
      );

      const orderRows = orderWithItemsResult.rows;
      const formattedOrder = {
        id: order.id,
        tableId: order.tableNumber,
        tableNumber: order.tableNumber,
        items: orderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(order.finalAmount.toString()),
        status: order.status.toLowerCase(),
        waiterId: order.createdById,
        waiterName:
          orderRows[0].createdByUserName ||
          orderRows[0].sourceDetails ||
          (orderRows[0].waiter_first_name && orderRows[0].waiter_last_name
            ? `${orderRows[0].waiter_first_name} ${orderRows[0].waiter_last_name}`
            : "Unknown"),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      };

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
      const validStatuses = ["active", "paid", "cancelled"];
      if (!validStatuses.includes(status)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Invalid status value. Use: active, paid, cancelled",
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
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

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

// PUT /api/orders/:id/pay - Mark order as paid
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
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      const user = (req as any).user;

      // Update order payment status
      await executeQuery(
        `UPDATE orders SET 
        "paymentStatus" = $1, 
        "paymentMethod" = $2, 
        "paidByUserId" = $3, 
        "paidAt" = $4, 
        "updatedAt" = $5 
       WHERE id = $6`,
        ["PAID", paymentMethod, user?.id || paidBy, new Date(), new Date(), id]
      );

      logger.info(`Order marked as paid: ${id} - Method: ${paymentMethod}`);
      sendSuccess(res, { success: true }, "Order marked as paid successfully");
    } catch (error) {
      logger.error("Mark order as paid error:", error);
      sendError(res, "PAYMENT_ERROR", "Failed to mark order as paid");
    }
  }
);

// PUT /api/orders/:id/modify/batch - Modify order with multiple changes
router.put(
  "/:id/modify/batch",
  authenticateToken,
  requireRole(["WAITER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      logger.info("=== MODIFY ORDER BATCH ROUTE CALLED ===");
      logger.info(`Request params: ${JSON.stringify(req.params)}`);
      logger.info(`Request body: ${JSON.stringify(req.body)}`);

      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { changes } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!changes || !Array.isArray(changes) || changes.length === 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Changes array is required and must not be empty",
          400
        );
      }

      // Check if order exists
      const existingOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      const user = (req as any).user;
      const addedItems: any[] = [];
      const removedItems: any[] = [];
      const modifiedItems: any[] = [];
      let totalChange = 0;

      // Process all changes
      for (const change of changes) {
        const { action, itemId, quantity, notes, reason } = change;

        if (!action || !itemId) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Action and itemId are required for each change",
            400
          );
        }

        // Check if menu item exists
        const menuItemResult = await executeQuery(
          'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
          [itemId, tenantId]
        );

        if (menuItemResult.rows.length === 0) {
          return sendError(
            res,
            "MENU_ITEM_NOT_FOUND",
            `Menu item ${itemId} not found`,
            400
          );
        }

        const menuItem = menuItemResult.rows[0];

        if (action === "add_item") {
          const itemTotal = parseFloat(menuItem.price.toString()) * quantity;

          await executeQuery(
            `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              id,
              itemId,
              quantity,
              menuItem.price,
              itemTotal,
              notes,
              new Date(),
            ]
          );

          totalChange += itemTotal;
          addedItems.push({
            name: menuItem.name,
            quantity: quantity,
            price: parseFloat(menuItem.price.toString()),
            notes: notes || "",
          });

          logger.info(
            `Item added to order: ${id} - Item: ${menuItem.name}, Quantity: ${quantity}`
          );
        } else if (action === "remove_item") {
          // Get existing order item
          const orderItemResult = await executeQuery(
            'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
            [id, itemId]
          );

          if (orderItemResult.rows.length === 0) {
            return sendError(
              res,
              "ITEM_NOT_FOUND",
              `Item ${itemId} not found in order`,
              400
            );
          }

          const orderItem = orderItemResult.rows[0];
          const itemTotal = parseFloat(orderItem.totalPrice.toString());

          await executeQuery(
            'DELETE FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
            [id, itemId]
          );

          totalChange -= itemTotal;
          removedItems.push({
            name: menuItem.name,
            quantity: orderItem.quantity,
            price: parseFloat(orderItem.unitPrice.toString()),
            reason: reason || "",
          });

          logger.info(
            `Item removed from order: ${id} - Item: ${menuItem.name}`
          );
        } else if (action === "change_quantity") {
          // Get existing order item
          const orderItemResult = await executeQuery(
            'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
            [id, itemId]
          );

          if (orderItemResult.rows.length === 0) {
            return sendError(
              res,
              "ITEM_NOT_FOUND",
              `Item ${itemId} not found in order`,
              400
            );
          }

          const orderItem = orderItemResult.rows[0];
          const oldQuantity = orderItem.quantity;
          const newQuantity = quantity;
          const pricePerUnit = parseFloat(orderItem.unitPrice.toString());
          const oldTotal = parseFloat(orderItem.totalPrice.toString());
          const newTotal = pricePerUnit * newQuantity;

          await executeQuery(
            'UPDATE "orderItems" SET quantity = $1, "totalPrice" = $2, notes = $3 WHERE "orderId" = $4 AND "menuItemId" = $5',
            [newQuantity, newTotal, notes, id, itemId]
          );

          totalChange += newTotal - oldTotal;
          modifiedItems.push({
            name: menuItem.name,
            oldQuantity: oldQuantity,
            newQuantity: newQuantity,
            price: pricePerUnit,
            notes: notes || "",
          });

          logger.info(
            `Item quantity changed in order: ${id} - Item: ${menuItem.name}, New Quantity: ${newQuantity}`
          );
        } else {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Invalid action. Use: add_item, remove_item, change_quantity",
            400
          );
        }
      }

      // Update order total
      const currentTotal = parseFloat(
        existingOrderResult.rows[0].totalAmount.toString()
      );
      const newTotal = currentTotal + totalChange;

      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
        [newTotal, newTotal, new Date(), id]
      );

      // Get updated order with items for receipt
      const updatedOrderResult = await executeQuery(
        `
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name,
             u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      LEFT JOIN users u ON o."createdById" = u.id
      WHERE o.id = $1
    `,
        [id]
      );

      const updatedOrderRows = updatedOrderResult.rows;
      const updatedFormattedOrder = {
        id: updatedOrderRows[0].id,
        tableId: updatedOrderRows[0].tableNumber,
        tableNumber: updatedOrderRows[0].tableNumber,
        items: updatedOrderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(updatedOrderRows[0].finalAmount.toString()),
        status: updatedOrderRows[0].status.toLowerCase(),
        waiterId: updatedOrderRows[0].createdById,
        waiterName:
          updatedOrderRows[0].createdByUserName ||
          updatedOrderRows[0].sourceDetails ||
          (updatedOrderRows[0].waiter_first_name &&
          updatedOrderRows[0].waiter_last_name
            ? `${updatedOrderRows[0].waiter_first_name} ${updatedOrderRows[0].waiter_last_name}`
            : "Unknown"),
        createdAt: updatedOrderRows[0].createdAt,
        updatedAt: updatedOrderRows[0].updatedAt,
      };

      // Determine modification type
      let modificationType: "add" | "remove" | "modify" | "mixed" = "mixed";
      if (
        addedItems.length > 0 &&
        removedItems.length === 0 &&
        modifiedItems.length === 0
      ) {
        modificationType = "add";
      } else if (
        removedItems.length > 0 &&
        addedItems.length === 0 &&
        modifiedItems.length === 0
      ) {
        modificationType = "remove";
      } else if (
        modifiedItems.length > 0 &&
        addedItems.length === 0 &&
        removedItems.length === 0
      ) {
        modificationType = "modify";
      }

      // Emit single notification with all changes
      try {
        const modifiedBy =
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown";

        logger.info("Attempting to emit batch order modification receipt...");
        socketManager.emitOrderModificationReceipt(
          tenantId,
          updatedFormattedOrder,
          {
            addedItems: addedItems.length > 0 ? addedItems : undefined,
            removedItems: removedItems.length > 0 ? removedItems : undefined,
            modifiedItems: modifiedItems.length > 0 ? modifiedItems : undefined,
            modificationType: modificationType,
            modifiedBy: modifiedBy,
            reason: "Batch modification",
          }
        );
        logger.info("Successfully emitted batch order modification receipt");
      } catch (error) {
        logger.error("Failed to emit WebSocket event:", error);
        // Don't fail the order modification if WebSocket fails
      }

      logger.info(
        `Batch order modification completed: ${id} - ${changes.length} changes applied`
      );
      sendSuccess(
        res,
        {
          success: true,
          changesApplied: changes.length,
          addedItems: addedItems.length,
          removedItems: removedItems.length,
          modifiedItems: modifiedItems.length,
        },
        "Order modified successfully"
      );
    } catch (error) {
      logger.error("Batch modify order error:", error);
      sendError(res, "MODIFY_ERROR", "Failed to modify order");
    }
  }
);

// ==================== MERGE BILLS ROUTES ====================

// POST /api/v1/orders/validate-merge - Validate merge operation
router.post(
  "/validate-merge",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { sourceOrderIds, targetOrderId } = req.body;

      if (
        !sourceOrderIds ||
        !Array.isArray(sourceOrderIds) ||
        sourceOrderIds.length === 0
      ) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Source order IDs are required",
          400
        );
      }

      // Get all orders to validate
      const allOrderIds = targetOrderId
        ? [...sourceOrderIds, targetOrderId]
        : sourceOrderIds;

      logger.info(
        "mergeDebug: Validating merge for order IDs:",
        allOrderIds.join(", ")
      );

      const ordersQuery = `
      SELECT o.*, o."tableNumber" as table_number
      FROM orders o
      WHERE o.id = ANY($1) AND o."tenantId" = $2
    `;
      const ordersResult = await executeQuery(ordersQuery, [
        allOrderIds,
        tenantId,
      ]);

      logger.info(
        "mergeDebug: Found orders:",
        ordersResult.rows.length,
        "expected:",
        allOrderIds.length
      );
      logger.info(
        "mergeDebug: Found order IDs:",
        ordersResult.rows.map((o) => o.id).join(", ")
      );

      if (ordersResult.rows.length !== allOrderIds.length) {
        return sendError(res, "NOT_FOUND", "One or more orders not found", 404);
      }

      const orders = ordersResult.rows;
      const restrictions: string[] = [];
      const warnings: string[] = [];

      // Validation checks
      // Table restriction removed - orders can be merged from any table
      const tableNumbers = [...new Set(orders.map((o) => o.tableNumber))];

      const invalidOrders = orders.filter(
        (o) =>
          !["active", "ACTIVE", "pending", "PENDING"].includes(
            o.status.toLowerCase()
          )
      );
      if (invalidOrders.length > 0) {
        restrictions.push("All orders must be in active status");
      }

      const paidOrders = orders.filter(
        (o) => o.status.toLowerCase() === "paid"
      );
      if (paidOrders.length > 0) {
        restrictions.push("Cannot merge paid orders");
      }

      // Check payment method conflicts
      const paymentMethods = [
        ...new Set(orders.map((o) => o.paymentMethod).filter(Boolean)),
      ];
      if (paymentMethods.length > 1) {
        warnings.push("Orders have different payment methods");
      }

      // Check customer information conflicts
      const customerNames = [
        ...new Set(orders.map((o) => o.customerName).filter(Boolean)),
      ];
      if (customerNames.length > 1) {
        warnings.push("Orders have different customer names");
      }

      const canMerge = restrictions.length === 0;
      const totalAmount = orders.reduce(
        (sum, order) => sum + parseFloat(order.totalAmount || 0),
        0
      );
      const totalItems = orders.reduce(
        (sum, order) => sum + parseInt(order.item_count || 0),
        0
      );

      // Create preview of merged order
      const preview = {
        mergedOrder: {
          id: targetOrderId || `merged_${Date.now()}`,
          orderNumber: targetOrderId
            ? orders.find((o) => o.id === targetOrderId)?.orderNumber
            : `MERGED-${Date.now()}`,
          customerName:
            customerNames.length === 1
              ? customerNames[0]
              : customerNames.join(" & "),
          totalAmount: totalAmount,
          status: "active",
          tableNumber:
            tableNumbers.length === 1
              ? tableNumbers[0]
              : `MULTI-TABLE (${tableNumbers.join(", ")})`,
          sourceTables: tableNumbers,
        },
        totalAmount,
        itemCount: totalItems,
      };

      sendSuccess(res, {
        canMerge,
        restrictions,
        warnings,
        preview,
      });
    } catch (error) {
      logger.error("Validate merge error:", error);
      sendError(res, "VALIDATION_ERROR", "Failed to validate merge operation");
    }
  }
);

// POST /api/v1/orders/merge - Merge orders
router.post(
  "/merge",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER"]),
  async (req: Request, res: Response) => {
    logger.info("mergeDebug: MERGE ENDPOINT HIT");
    try {
      logger.info("mergeDebug: MERGE ENDPOINT CALLED");
      const tenantId = getTenantId(req);
      const userId = (req as any).user?.id;
      const {
        sourceOrderIds,
        targetOrderId,
        mergeStrategy = "append",
        customerName,
        customerPhone,
        specialInstructions,
        waiterId,
        waiterName,
        tableId,
        createNewOrder = false,
      } = req.body;

      if (
        !sourceOrderIds ||
        !Array.isArray(sourceOrderIds) ||
        sourceOrderIds.length === 0
      ) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Source order IDs are required",
          400
        );
      }

      // Table ID is optional now since orders can be merged from different tables
      // If tableId is provided, use it; otherwise, use the first order's table

      // Validate merge first
      const validateResponse = await executeQuery(
        `
      SELECT o.*, o."tableNumber" as table_number
      FROM orders o
      WHERE o.id = ANY($1) AND o."tenantId" = $2
    `,
        [sourceOrderIds, tenantId]
      );

      if (validateResponse.rows.length !== sourceOrderIds.length) {
        return sendError(res, "NOT_FOUND", "One or more orders not found", 404);
      }

      logger.info(
        "mergeDebug: Orders validation passed, found",
        validateResponse.rows.length,
        "orders"
      );
      let sourceOrders = validateResponse.rows;

      // Check if orders can be merged
      const invalidOrders = sourceOrders.filter(
        (o) =>
          !["active", "ACTIVE", "pending", "PENDING"].includes(
            o.status.toLowerCase()
          )
      );
      if (invalidOrders.length > 0) {
        return sendError(
          res,
          "INVALID_ORDERS",
          "One or more orders cannot be merged",
          400
        );
      }

      // Determine target order based on merge strategy
      let targetOrder;
      let mergedOrderId;

      if (mergeStrategy === "append") {
        // Append strategy: Use one of the source orders as target, or specified target
        if (targetOrderId) {
          // User specified a target order
          const targetResult = await executeQuery(
            `
          SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2
        `,
            [targetOrderId, tenantId]
          );

          if (targetResult.rows.length === 0) {
            return sendError(res, "NOT_FOUND", "Target order not found", 404);
          }

          targetOrder = targetResult.rows[0];
          mergedOrderId = targetOrderId;

          // Filter out the target order from source orders
          sourceOrders = sourceOrders.filter(
            (order) => order.id !== targetOrderId
          );
        } else {
          // Use the first source order as the target (append others to it)
          targetOrder = sourceOrders[0];
          mergedOrderId = sourceOrders[0].id;

          // Remove the target order from source orders list since it won't be merged into itself
          sourceOrders = sourceOrders.slice(1);
        }
      } else if (createNewOrder || !targetOrderId) {
        // Create new merged order (for other strategies or when no target specified)
        mergedOrderId = `order_merged_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 5)}`;

        // For create new strategy, use the target order's table if specified
        const targetTableNumber = targetOrderId
          ? targetOrder.tableNumber
          : tableId || sourceOrders[0]?.tableNumber || "MERGED";

        const newOrderData = {
          id: mergedOrderId,
          orderNumber: `MERGED-${Date.now()}`,
          customerName:
            customerName ||
            sourceOrders
              .map((o) => o.customerName)
              .filter(Boolean)
              .join(" & "),
          customerPhone: customerPhone || sourceOrders[0]?.customerPhone,
          specialInstructions: specialInstructions || "Merged order",
          tableNumber: targetTableNumber,
          tenantId,
          createdByUserId: waiterId || sourceOrders[0]?.createdByUserId,
          createdByUserName: waiterName || sourceOrders[0]?.createdByUserName,
          status: "active",
          totalAmount: 0,
          taxAmount: 0,
          discountAmount: 0,
          finalAmount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await executeQuery(
          `
          INSERT INTO orders (id, "orderNumber", "customerName", "customerPhone", "specialInstructions",
                            "tableNumber", "tenantId", "createdByUserId", "createdByUserName", status,
                            "totalAmount", "taxAmount", "discountAmount", "finalAmount",
                            "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
          [
            newOrderData.id,
            newOrderData.orderNumber,
            newOrderData.customerName,
            newOrderData.customerPhone,
            newOrderData.specialInstructions,
            newOrderData.tableNumber,
            newOrderData.tenantId,
            newOrderData.createdByUserId,
            newOrderData.createdByUserName,
            newOrderData.status,
            newOrderData.totalAmount,
            newOrderData.taxAmount,
            newOrderData.discountAmount,
            newOrderData.finalAmount,
            newOrderData.createdAt,
            newOrderData.updatedAt,
          ]
        );

        targetOrder = newOrderData;
      } else {
        // Merge into existing order (fallback)
        const targetResult = await executeQuery(
          `
        SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2
      `,
          [targetOrderId, tenantId]
        );

        if (targetResult.rows.length === 0) {
          return sendError(res, "NOT_FOUND", "Target order not found", 404);
        }

        targetOrder = targetResult.rows[0];
        mergedOrderId = targetOrderId;
      }

      // Calculate total from ALL selected orders (including target order)
      logger.info(
        "mergeDebug: Starting merge logic, targetOrderId:",
        targetOrderId,
        "mergeStrategy:",
        mergeStrategy
      );

      // Get all orders that were selected (including target order)
      const allSelectedOrders = targetOrderId
        ? [...sourceOrders, targetOrder]
        : sourceOrders;

      let totalAmount = 0;
      let totalItems = 0;

      logger.info("mergeDebug: Calculating total from all selected orders");
      logger.info(
        "mergeDebug: All selected orders:",
        allSelectedOrders.map((o) => o.id).join(", ")
      );

      // Calculate total from all selected orders
      for (const order of allSelectedOrders) {
        const orderTotal = parseFloat(order.totalAmount || 0);
        totalAmount += orderTotal;
        logger.info(
          "mergeDebug: Order",
          order.id,
          "total:",
          orderTotal,
          "running total:",
          totalAmount
        );
      }

      // For append strategy, we need to recalculate the total based on actual items
      // since we're moving items to the target order
      if (mergeStrategy === "append") {
        logger.info("mergeDebug: Recalculating total for append strategy");

        // Get target order's existing items
        const targetItemsQuery = `
          SELECT * FROM "orderItems" WHERE "orderId" = $1
        `;
        const targetItemsResult = await executeQuery(targetItemsQuery, [
          mergedOrderId,
        ]);

        let recalculatedTotal = 0;

        // Add target order's existing items
        for (const item of targetItemsResult.rows) {
          const itemPrice = parseFloat(item.totalPrice || 0);
          recalculatedTotal += itemPrice;
        }

        // Add source orders' items
        for (const sourceOrder of sourceOrders) {
          const sourceItemsQuery = `
            SELECT * FROM "orderItems" WHERE "orderId" = $1
          `;
          const sourceItemsResult = await executeQuery(sourceItemsQuery, [
            sourceOrder.id,
          ]);

          for (const item of sourceItemsResult.rows) {
            const itemPrice = parseFloat(item.totalPrice || 0);
            recalculatedTotal += itemPrice;
          }
        }

        totalAmount = recalculatedTotal;
        logger.info("mergeDebug: Recalculated total:", totalAmount);
      }

      // Move all items from source orders to target order
      for (const sourceOrder of sourceOrders) {
        // Skip if this is the target order (shouldn't happen, but just in case)
        if (sourceOrder.id === mergedOrderId) {
          logger.info(
            "mergeDebug: Skipping target order",
            sourceOrder.id,
            "in source orders loop"
          );
          continue;
        }

        // Get items from source order
        const itemsQuery = `
          SELECT * FROM "orderItems" WHERE "orderId" = $1
        `;
        const itemsResult = await executeQuery(itemsQuery, [sourceOrder.id]);

        // Move items to target order
        for (const item of itemsResult.rows) {
          const newItemId = `oi_merged_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`;

          await executeQuery(
            `
            INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, notes, 
                                     "unitPrice", "totalPrice", "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
            [
              newItemId,
              mergedOrderId,
              item.menuItemId,
              item.quantity,
              item.notes,
              item.unitPrice,
              item.totalPrice,
              new Date(),
            ]
          );

          totalItems += parseInt(item.quantity || 1);
          logger.info(
            "mergeDebug: Moved item",
            item.menuItemId,
            "from order",
            sourceOrder.id,
            "to target order",
            mergedOrderId
          );
        }

        // Mark source order as merged (this should never be the target order)
        await executeQuery(
          `
            UPDATE orders SET status = 'merged', "updatedAt" = $1
            WHERE id = $2
          `,
          [new Date(), sourceOrder.id]
        );
        logger.info(
          "mergeDebug: Marked source order",
          sourceOrder.id,
          "as merged"
        );

        // Record merge history
        const historyId = `merge_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 5)}`;
        // Record merge history (if table exists)
        try {
          await executeQuery(
            `
            INSERT INTO order_merge_history (id, merged_order_id, source_order_id, table_number,
                                          merged_by, merge_reason, merge_strategy,
                                          customer_name_before, customer_name_after,
                                          total_amount_before, total_amount_after)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
            [
              historyId,
              mergedOrderId,
              sourceOrder.id,
              sourceOrder.tableNumber || tableId,
              userId,
              "Customer request",
              mergeStrategy,
              sourceOrder.customerName,
              targetOrder.customerName,
              sourceOrder.totalAmount,
              totalAmount,
            ]
          );
        } catch (error) {
          logger.warn(
            "Merge history table not available, skipping audit trail"
          );
        }
      }

      // Update target order with new total and ensure it remains active
      // The target order stays in its original table
      await executeQuery(
        `
        UPDATE orders SET "totalAmount" = $1, "finalAmount" = $1, "updatedAt" = $2, status = 'active' WHERE id = $3
      `,
        [totalAmount, new Date(), mergedOrderId]
      );

      logger.info(
        "mergeDebug: Updated target order",
        mergedOrderId,
        "with total amount",
        totalAmount,
        "and kept it active in its original table"
      );

      // Verify the total was set correctly
      const totalCheckQuery = `
        SELECT "totalAmount", "finalAmount" FROM orders WHERE id = $1
      `;
      const totalCheckResult = await executeQuery(totalCheckQuery, [
        mergedOrderId,
      ]);
      logger.info(
        "mergeDebug: Database shows total:",
        totalCheckResult.rows[0]?.totalAmount,
        "final:",
        totalCheckResult.rows[0]?.finalAmount
      );

      // Double-check the target order status
      const statusCheckQuery = `
        SELECT status FROM orders WHERE id = $1
      `;
      const statusResult = await executeQuery(statusCheckQuery, [
        mergedOrderId,
      ]);
      logger.info(
        "mergeDebug: Target order",
        mergedOrderId,
        "final status:",
        statusResult.rows[0]?.status
      );

      // Ensure target order is never marked as merged - force it to active
      if (statusResult.rows[0]?.status !== "active") {
        await executeQuery(
          `
          UPDATE orders SET status = 'active', "updatedAt" = $1 WHERE id = $2
        `,
          [new Date(), mergedOrderId]
        );
        logger.info(
          "mergeDebug: Forced target order",
          mergedOrderId,
          "to active status"
        );
      }

      // ALWAYS ensure target order is active at the end
      await executeQuery(
        `
        UPDATE orders SET status = 'active', "updatedAt" = $1 WHERE id = $2
      `,
        [new Date(), mergedOrderId]
      );
      logger.info(
        "mergeDebug: Final guarantee: Target order",
        mergedOrderId,
        "is active"
      );

      // Final status check
      const finalStatusCheck = await executeQuery(statusCheckQuery, [
        mergedOrderId,
      ]);
      logger.info(
        "mergeDebug: Final target order",
        mergedOrderId,
        "status:",
        finalStatusCheck.rows[0]?.status
      );

      if (finalStatusCheck.rows[0]?.status !== "active") {
        logger.info(
          "mergeDebug: CRITICAL: Target order",
          mergedOrderId,
          "is not active! Status:",
          finalStatusCheck.rows[0]?.status
        );
      } else {
        logger.info(
          "mergeDebug: SUCCESS: Target order",
          mergedOrderId,
          "is active and visible"
        );
      }

      // Get final merged order with items
      const finalOrderQuery = `
      SELECT o.*, COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      WHERE o.id = $1
      GROUP BY o.id
    `;
      const finalOrderResult = await executeQuery(finalOrderQuery, [
        mergedOrderId,
      ]);
      const mergedOrder = finalOrderResult.rows[0];

      logger.info(
        "mergeDebug: Final query returned order status:",
        mergedOrder?.status
      );
      logger.info(
        "mergeDebug: Final query returned order ID:",
        mergedOrder?.id
      );

      // Get items for merged order
      const itemsQuery = `
      SELECT oi.*, mi.name as item_name, mi.description as item_description,
             oi."unitPrice" as item_price
      FROM "orderItems" oi
      JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE oi."orderId" = $1
      ORDER BY oi."createdAt" ASC
    `;
      const itemsResult = await executeQuery(itemsQuery, [mergedOrderId]);

      const mergeSummary = {
        totalItems,
        totalAmount,
        itemCount: itemsResult.rows.length,
        customerCount: sourceOrders.length,
        ordersMerged: sourceOrders.length,
      };

      logger.info(
        `Orders merged: ${sourceOrderIds.join(", ")} into ${mergedOrderId}`
      );

      sendSuccess(res, {
        mergedOrder: {
          ...mergedOrder,
          status: "active", // Ensure response shows active status
          items: itemsResult.rows,
        },
        sourceOrders,
        mergeSummary,
      });
    } catch (error) {
      logger.error("Merge orders error:", error);
      sendError(res, "MERGE_ERROR", "Failed to merge orders");
    }
  }
);

// POST /api/v1/orders/:id/split - Split items from existing order to new order
router.post(
  "/:id/split",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id: sourceOrderId } = req.params;
      const {
        itemsToSplit,
        newTableId,
        customerName,
        customerPhone,
        specialInstructions,
        reason,
      } = req.body;

      if (!sourceOrderId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Source order ID is required",
          400
        );
      }

      if (
        !itemsToSplit ||
        !Array.isArray(itemsToSplit) ||
        itemsToSplit.length === 0
      ) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Items to split are required",
          400
        );
      }

      // Validate itemsToSplit format: [{ itemId: "oi_123", quantity: 2 }]
      for (const item of itemsToSplit) {
        if (!item.itemId || !item.quantity || item.quantity <= 0) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Each item must have itemId and positive quantity",
            400
          );
        }
      }

      // Check if source order exists and is active
      const sourceOrderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [sourceOrderId, tenantId]
      );

      if (sourceOrderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Source order not found", 404);
      }

      const sourceOrder = sourceOrderResult.rows[0];

      // Check if source order can be split (must be active or pending)
      if (
        !["active", "ACTIVE", "pending", "PENDING"].includes(
          sourceOrder.status.toLowerCase()
        )
      ) {
        return sendError(
          res,
          "INVALID_ORDER_STATUS",
          "Only active or pending orders can be split",
          400
        );
      }

      // If newTableId provided, verify table exists
      let targetTableId = newTableId || sourceOrder.tableNumber;
      if (newTableId) {
        const tableResult = await executeQuery(
          'SELECT * FROM tables WHERE (number = $1 OR id = $1) AND "tenantId" = $2',
          [newTableId, tenantId]
        );

        if (tableResult.rows.length === 0) {
          return sendError(
            res,
            "TABLE_NOT_FOUND",
            `Table ${newTableId} not found`,
            400
          );
        }
      }

      // Get source order items to validate split request
      const sourceItemsResult = await executeQuery(
        'SELECT * FROM "orderItems" WHERE "orderId" = $1',
        [sourceOrderId]
      );

      const sourceItems = sourceItemsResult.rows;
      const sourceItemsMap = new Map(
        sourceItems.map((item) => [item.id, item])
      );

      // Validate all items to split exist and have sufficient quantity
      let newOrderTotal = 0;
      const validatedSplitItems: any[] = [];

      for (const splitItem of itemsToSplit) {
        const sourceItem = sourceItemsMap.get(splitItem.itemId);

        if (!sourceItem) {
          return sendError(
            res,
            "ITEM_NOT_FOUND",
            `Item ${splitItem.itemId} not found in source order`,
            400
          );
        }

        if (splitItem.quantity > sourceItem.quantity) {
          return sendError(
            res,
            "INSUFFICIENT_QUANTITY",
            `Cannot split ${splitItem.quantity} of item ${splitItem.itemId}. Only ${sourceItem.quantity} available`,
            400
          );
        }

        const itemTotal = parseFloat(sourceItem.unitPrice) * splitItem.quantity;
        newOrderTotal += itemTotal;

        validatedSplitItems.push({
          ...splitItem,
          sourceItem,
          itemTotal,
        });
      }

      const user = (req as any).user;

      // Create new order
      const newOrderId = `order_split_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`;
      const newOrderNumber = `SPLIT-${Date.now()}`;

      const newOrderData = {
        id: newOrderId,
        orderNumber: newOrderNumber,
        tableNumber: targetTableId,
        totalAmount: newOrderTotal,
        taxAmount: 0,
        discountAmount: 0,
        finalAmount: newOrderTotal,
        tenantId,
        createdById: user?.id || null,
        createdByUserId: user?.id || null,
        createdByUserName:
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown",
        status: "active",
        orderSource: "SPLIT",
        sourceDetails: `Split from order ${sourceOrder.orderNumber}`,
        customerName: customerName || sourceOrder.customerName,
        customerPhone: customerPhone || sourceOrder.customerPhone,
        specialInstructions:
          specialInstructions ||
          `Split from ${sourceOrder.orderNumber}: ${reason || "Order split"}`,
        isDelivery: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Insert new order
      await executeQuery(
        `INSERT INTO orders (
          id, "orderNumber", "tableNumber", "totalAmount", "taxAmount", "discountAmount", "finalAmount",
          "tenantId", "createdById", "createdByUserId", "createdByUserName", status, "orderSource", "sourceDetails",
          "customerName", "customerPhone", "specialInstructions", "isDelivery", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          newOrderData.id,
          newOrderData.orderNumber,
          newOrderData.tableNumber,
          newOrderData.totalAmount,
          newOrderData.taxAmount,
          newOrderData.discountAmount,
          newOrderData.finalAmount,
          newOrderData.tenantId,
          newOrderData.createdById,
          newOrderData.createdByUserId,
          newOrderData.createdByUserName,
          newOrderData.status,
          newOrderData.orderSource,
          newOrderData.sourceDetails,
          newOrderData.customerName,
          newOrderData.customerPhone,
          newOrderData.specialInstructions,
          newOrderData.isDelivery,
          newOrderData.createdAt,
          newOrderData.updatedAt,
        ]
      );

      // Process each item to split
      let sourceOrderNewTotal = parseFloat(sourceOrder.totalAmount);

      for (const splitItem of validatedSplitItems) {
        const { sourceItem, quantity, itemTotal } = splitItem;

        // Create new order item
        const newItemId = `oi_split_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 5)}`;

        await executeQuery(
          `INSERT INTO "orderItems" (
            id, "orderId", "menuItemId", quantity, notes, "unitPrice", "totalPrice", "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            newItemId,
            newOrderId,
            sourceItem.menuItemId,
            quantity,
            sourceItem.notes,
            sourceItem.unitPrice,
            itemTotal,
            new Date(),
          ]
        );

        // Update source order item quantity or remove if fully split
        const remainingQuantity = sourceItem.quantity - quantity;

        if (remainingQuantity <= 0) {
          // Remove item completely from source order
          await executeQuery('DELETE FROM "orderItems" WHERE id = $1', [
            sourceItem.id,
          ]);
        } else {
          // Update quantity and total price
          const newSourceItemTotal =
            parseFloat(sourceItem.unitPrice) * remainingQuantity;
          await executeQuery(
            'UPDATE "orderItems" SET quantity = $1, "totalPrice" = $2 WHERE id = $3',
            [remainingQuantity, newSourceItemTotal, sourceItem.id]
          );
        }

        // Subtract split amount from source order total
        sourceOrderNewTotal -= itemTotal;

        logger.info(
          `Split item ${sourceItem.menuItemId}: ${quantity} units (${itemTotal}) moved to new order ${newOrderId}`
        );
      }

      // Update source order total
      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $1, "updatedAt" = $2 WHERE id = $3',
        [sourceOrderNewTotal, new Date(), sourceOrderId]
      );

      // Check if source order has any items left
      const remainingItemsResult = await executeQuery(
        'SELECT COUNT(*) as count FROM "orderItems" WHERE "orderId" = $1',
        [sourceOrderId]
      );

      const hasRemainingItems =
        parseInt(remainingItemsResult.rows[0].count) > 0;

      // If no items left, mark source order as completed/split
      if (!hasRemainingItems) {
        await executeQuery(
          'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE id = $3',
          ["split_empty", new Date(), sourceOrderId]
        );
      }

      // Get the new order with items for response
      const newOrderWithItemsResult = await executeQuery(
        `SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE o.id = $1`,
        [newOrderId]
      );

      const newOrderRows = newOrderWithItemsResult.rows;
      const formattedNewOrder = {
        id: newOrderRows[0].id,
        orderNumber: newOrderRows[0].orderNumber,
        tableId: newOrderRows[0].tableNumber,
        tableNumber: newOrderRows[0].tableNumber,
        items: newOrderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            totalPrice: parseFloat(row.totalPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(newOrderRows[0].totalAmount.toString()),
        status: newOrderRows[0].status.toLowerCase(),
        customerName: newOrderRows[0].customerName,
        customerPhone: newOrderRows[0].customerPhone,
        specialInstructions: newOrderRows[0].specialInstructions,
        createdAt: newOrderRows[0].createdAt,
        updatedAt: newOrderRows[0].updatedAt,
      };

      // Get updated source order
      const updatedSourceResult = await executeQuery(
        `SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE o.id = $1`,
        [sourceOrderId]
      );

      const sourceOrderRows = updatedSourceResult.rows;
      const formattedSourceOrder = {
        id: sourceOrderRows[0].id,
        orderNumber: sourceOrderRows[0].orderNumber,
        tableId: sourceOrderRows[0].tableNumber,
        tableNumber: sourceOrderRows[0].tableNumber,
        items: sourceOrderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            totalPrice: parseFloat(row.totalPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(sourceOrderRows[0].totalAmount.toString()),
        status: sourceOrderRows[0].status.toLowerCase(),
        hasRemainingItems,
        customerName: sourceOrderRows[0].customerName,
        customerPhone: sourceOrderRows[0].customerPhone,
        specialInstructions: sourceOrderRows[0].specialInstructions,
        createdAt: sourceOrderRows[0].createdAt,
        updatedAt: sourceOrderRows[0].updatedAt,
      };

      const splitDetails = {
        sourceOrderId,
        newOrderId,
        itemsSplit: validatedSplitItems.length,
        totalSplitAmount: newOrderTotal,
        sourceOrderRemainingTotal: sourceOrderNewTotal,
        fromTable: sourceOrder.tableNumber,
        toTable: targetTableId,
        reason: reason || "Order split requested",
        splitBy:
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown",
        splitAt: new Date(),
      };

      logger.info(
        `Order split: ${sourceOrderId} → ${newOrderId} | ${validatedSplitItems.length} items | $${newOrderTotal}`
      );

      sendSuccess(
        res,
        {
          newOrder: formattedNewOrder,
          updatedSourceOrder: formattedSourceOrder,
          splitDetails,
        },
        "Order split successfully"
      );
    } catch (error) {
      logger.error("Split order error:", error);
      sendError(res, "SPLIT_ERROR", "Failed to split order");
    }
  }
);

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
      const orderResult = await executeQuery(
        'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];

      // Check if order can be moved (must be active or pending)
      if (
        !["active", "ACTIVE", "pending", "PENDING"].includes(
          order.status.toLowerCase()
        )
      ) {
        return sendError(
          res,
          "INVALID_ORDER_STATUS",
          "Only active or pending orders can be moved",
          400
        );
      }

      // Verify new table exists (check both number and id)
      const tableResult = await executeQuery(
        'SELECT * FROM tables WHERE (number = $1 OR id = $1) AND "tenantId" = $2',
        [tableId, tenantId]
      );

      if (tableResult.rows.length === 0) {
        return sendError(
          res,
          "TABLE_NOT_FOUND",
          `Table ${tableId} not found`,
          400
        );
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
      const updatedOrderResult = await executeQuery(
        `
        SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
               mi.name as menu_item_name,
               u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        LEFT JOIN users u ON o."createdById" = u.id
        WHERE o.id = $1
      `,
        [id]
      );

      const updatedOrderRows = updatedOrderResult.rows;
      const updatedFormattedOrder = {
        id: updatedOrderRows[0].id,
        tableId: updatedOrderRows[0].tableNumber,
        tableNumber: updatedOrderRows[0].tableNumber,
        items: updatedOrderRows
          .filter((row) => row.item_id)
          .map((row) => ({
            id: row.item_id,
            menuItemId: row.menuItemId,
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
            status: "active",
          })),
        total: parseFloat(updatedOrderRows[0].finalAmount.toString()),
        status: updatedOrderRows[0].status.toLowerCase(),
        waiterId: updatedOrderRows[0].createdById,
        waiterName:
          updatedOrderRows[0].createdByUserName ||
          updatedOrderRows[0].sourceDetails ||
          (updatedOrderRows[0].waiter_first_name &&
          updatedOrderRows[0].waiter_last_name
            ? `${updatedOrderRows[0].waiter_first_name} ${updatedOrderRows[0].waiter_last_name}`
            : "Unknown"),
        createdAt: updatedOrderRows[0].createdAt,
        updatedAt: updatedOrderRows[0].updatedAt,
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
