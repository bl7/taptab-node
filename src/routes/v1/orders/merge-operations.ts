import { Router, Request, Response } from "express";
import { logger } from "../../../utils/logger";
import { getTenantId } from "../../../middleware/tenant";
import { authenticateToken, requireRole } from "../../../middleware/auth";
import { sendSuccess, sendError } from "../../../utils/response";
import { executeQuery } from "../../../utils/database";

const router = Router();

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
          ? targetOrder?.tableNumber
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

export default router;
