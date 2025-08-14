import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";
import {
  formatOrderFromRows,
  generateItemId,
  getOrderWithItemsQuery,
} from "./helpers/order-formatters";
import {
  validateMenuItemExists,
  validateOrderExists,
} from "./helpers/validation";
import {
  emitOrderModificationEvent,
  getModifiedByUser,
} from "./helpers/websocket-events";

const router = Router();

// PUT /api/orders/:id/modify - Modify order (add/remove items)
router.put(
  "/:id/modify",
  authenticateToken,
  requireRole(["WAITER", "KITCHEN", "MANAGER", "TENANT_ADMIN"]),
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
      const existingOrder = await validateOrderExists(id, tenantId, res);
      if (!existingOrder) return;

      // Check if menu item exists
      const menuItem = await validateMenuItemExists(itemId, tenantId, res);
      if (!menuItem) return;

      const user = (req as any).user;

      if (action === "add_item") {
        // Add new item to order
        const itemTotal = parseFloat(menuItem.price.toString()) * quantity;

        await executeQuery(
          `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            generateItemId(),
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
        const currentTotal = parseFloat(existingOrder.totalAmount.toString());
        const newTotal = currentTotal + itemTotal;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newTotal, newTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          getOrderWithItemsQuery(),
          [id]
        );

        const updatedFormattedOrder = formatOrderFromRows(
          updatedOrderResult.rows
        );

        // Emit receipt with added items
        emitOrderModificationEvent(tenantId, updatedFormattedOrder, {
          addedItems: [
            {
              name: menuItem.name,
              quantity: quantity,
              price: parseFloat(menuItem.price.toString()),
              notes: notes,
            },
          ],
          modificationType: "add",
          modifiedBy: getModifiedByUser(user),
          reason: reason,
        });

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
        const currentTotal = parseFloat(existingOrder.totalAmount.toString());
        const newTotal = currentTotal - itemTotal;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newTotal, newTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          getOrderWithItemsQuery(),
          [id]
        );

        const updatedFormattedOrder = formatOrderFromRows(
          updatedOrderResult.rows
        );

        // Emit receipt with removed items
        emitOrderModificationEvent(tenantId, updatedFormattedOrder, {
          removedItems: [
            {
              name: menuItem.name,
              quantity: orderItem.quantity,
              price: parseFloat(orderItem.unitPrice.toString()),
              reason: reason,
            },
          ],
          modificationType: "remove",
          modifiedBy: getModifiedByUser(user),
          reason: reason,
        });

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
        const currentTotal = parseFloat(existingOrder.totalAmount.toString());
        const totalDifference = newTotal - oldTotal;
        const newOrderTotal = currentTotal + totalDifference;

        await executeQuery(
          'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
          [newOrderTotal, newOrderTotal, new Date(), id]
        );

        // Get updated order with items for receipt
        const updatedOrderResult = await executeQuery(
          getOrderWithItemsQuery(),
          [id]
        );

        const updatedFormattedOrder = formatOrderFromRows(
          updatedOrderResult.rows
        );

        // Emit receipt with modified items
        emitOrderModificationEvent(tenantId, updatedFormattedOrder, {
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
          modifiedBy: getModifiedByUser(user),
          reason: reason,
        });

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

// PUT /api/orders/:id/modify/batch - Modify order with multiple changes
router.put(
  "/:id/modify/batch",
  authenticateToken,
  requireRole(["WAITER", "KITCHEN", "MANAGER", "TENANT_ADMIN"]),
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
      const existingOrder = await validateOrderExists(id, tenantId, res);
      if (!existingOrder) return;

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
        const menuItem = await validateMenuItemExists(itemId, tenantId, res);
        if (!menuItem) return;

        if (action === "add_item") {
          const itemTotal = parseFloat(menuItem.price.toString()) * quantity;

          await executeQuery(
            `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              generateItemId(),
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
      const currentTotal = parseFloat(existingOrder.totalAmount.toString());
      const newTotal = currentTotal + totalChange;

      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
        [newTotal, newTotal, new Date(), id]
      );

      // Get updated order with items for receipt
      const updatedOrderResult = await executeQuery(getOrderWithItemsQuery(), [
        id,
      ]);

      const updatedFormattedOrder = formatOrderFromRows(
        updatedOrderResult.rows
      );

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
      const eventData: any = {
        modificationType: modificationType,
        modifiedBy: getModifiedByUser(user),
        reason: "Batch modification",
      };

      if (addedItems.length > 0) {
        eventData.addedItems = addedItems;
      }
      if (removedItems.length > 0) {
        eventData.removedItems = removedItems;
      }
      if (modifiedItems.length > 0) {
        eventData.modifiedItems = modifiedItems;
      }

      emitOrderModificationEvent(tenantId, updatedFormattedOrder, eventData);

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

export default router;
