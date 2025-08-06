import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
import {
  formatOrderFromRows,
  generateOrderId,
  generateItemId,
} from "./helpers/order-formatters";
import {
  validateOrderExists,
  validateTableExists,
  validateOrderStatus,
} from "./helpers/validation";

const router = Router();

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
      const sourceOrder = await validateOrderExists(
        sourceOrderId,
        tenantId,
        res
      );
      if (!sourceOrder) return;

      // Check if source order can be split (must be active or pending)
      if (!validateOrderStatus(sourceOrder, ["active", "pending"], res)) {
        return;
      }

      // If newTableId provided, verify table exists
      let targetTableId = newTableId || sourceOrder.tableNumber;
      if (newTableId) {
        if (!(await validateTableExists(newTableId, tenantId, res))) {
          return;
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
      const newOrderId = generateOrderId().replace("order_", "order_split_");
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
        const newItemId = generateItemId().replace("item_", "oi_split_");

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

      const formattedNewOrder = formatOrderFromRows(
        newOrderWithItemsResult.rows
      );

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

      const formattedSourceOrder = {
        ...formatOrderFromRows(updatedSourceResult.rows),
        hasRemainingItems,
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

export default router;
