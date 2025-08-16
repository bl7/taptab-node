// Helper functions for formatting order data consistently across all order operations
import { executeQuery } from "../../../../utils/database";
import { logger } from "../../../../utils/logger";

export function formatOrderFromRows(orderRows: any[]): any {
  if (orderRows.length === 0) return null;

  const firstRow = orderRows[0];

  // Extract sequential number from orderNumber (e.g., "160825-001" -> "001")
  const sequentialNumber = extractSequentialNumber(firstRow.orderNumber);

  return {
    id: firstRow.id,
    orderNumber: sequentialNumber, // Replace with just the sequential number
    tableId: firstRow.tableNumber,
    tableNumber: firstRow.tableNumber,
    items: orderRows
      .filter((row) => row.item_id)
      .map((row) => ({
        id: row.item_id,
        menuItemId: row.menuItemId,
        menuItemName: row.menu_item_name,
        quantity: row.quantity,
        price: parseFloat(row.unitPrice.toString()),
        totalPrice: parseFloat(
          (row.totalPrice || row.unitPrice * row.quantity).toString()
        ),
        notes: row.notes,
        status: "active",
      })),
    total: parseFloat(
      firstRow.finalAmount?.toString() || firstRow.totalAmount?.toString() || 0
    ),
    status: firstRow.status.toLowerCase(),
    paymentStatus: firstRow.paymentStatus || firstRow.paymentstatus || null,
    paymentMethod: firstRow.paymentMethod || firstRow.paymentmethod || null,
    paidAt: firstRow.paidAt || null,
    waiterId: firstRow.createdById,
    waiterName:
      firstRow.createdByUserName ||
      firstRow.sourceDetails ||
      (firstRow.waiter_first_name && firstRow.waiter_last_name
        ? `${firstRow.waiter_first_name} ${firstRow.waiter_last_name}`
        : "Unknown"),
    orderSource: firstRow.orderSource,
    sourceDetails: firstRow.sourceDetails,
    customerName: firstRow.customerName,
    customerPhone: firstRow.customerPhone,
    customerEmail: firstRow.customerEmail,
    specialInstructions: firstRow.specialInstructions,
    isDelivery: firstRow.isDelivery,
    deliveryAddress: firstRow.deliveryAddress,
    deliveryPlatform: firstRow.deliveryPlatform,
    deliveryOrderId: firstRow.deliveryOrderId,
    estimatedDeliveryTime: firstRow.estimatedDeliveryTime,
    taxAmount: parseFloat(firstRow.taxAmount?.toString() || 0),
    discountAmount: parseFloat(firstRow.discountAmount?.toString() || 0),
    // Cancellation details
    cancellationReason: firstRow.cancellationReason || null,
    cancelledByUserId: firstRow.cancelledByUserId || null,
    cancelledAt: firstRow.cancelledAt || null,
    cancelledBy:
      firstRow.cancelled_by_first_name && firstRow.cancelled_by_last_name
        ? `${firstRow.cancelled_by_first_name} ${firstRow.cancelled_by_last_name}`
        : firstRow.cancelledByUserId || null,
    createdAt: firstRow.createdAt,
    updatedAt: firstRow.updatedAt,
  };
}

export function formatOrdersFromRows(rows: any[]): any[] {
  // Group orders and their items
  const ordersMap = new Map();
  rows.forEach((row: any) => {
    if (!ordersMap.has(row.id)) {
      ordersMap.set(row.id, {
        id: row.id,
        orderNumber: extractSequentialNumber(row.orderNumber), // Replace with just the sequential number
        tableId: row.tableNumber,
        tableNumber: row.tableNumber,
        items: [],
        total: parseFloat(row.finalAmount.toString()),
        status: row.status.toLowerCase(),
        paymentStatus: row.paymentStatus || row.paymentstatus || null,
        paymentMethod: row.paymentMethod || row.paymentmethod || null,
        paidAt: row.paidAt || null,
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
        // Cancellation details
        cancellationReason: row.cancellationReason || null,
        cancelledByUserId: row.cancelledByUserId || null,
        cancelledAt: row.cancelledAt || null,
        cancelledBy:
          row.cancelled_by_first_name && row.cancelled_by_last_name
            ? `${row.cancelled_by_first_name} ${row.cancelled_by_last_name}`
            : row.cancelledByUserId || null,
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

  return Array.from(ordersMap.values());
}

export function getOrderWithItemsQuery(): string {
  return `
    SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
           mi.name as menu_item_name,
           u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
    FROM orders o
    LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
    LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
    LEFT JOIN users u ON o."createdById" = u.id
    WHERE o.id = $1
  `;
}

export function generateOrderId(): string {
  return `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

export function generateOrderNumber(): string {
  return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Generate a sequential daily order number
 * Format: DDMMYY-XXX where XXX is the sequential number for the day
 * @param tenantId - The tenant ID to scope the daily sequence
 * @returns Promise<string> - The generated order number
 */
export async function generateSequentialOrderNumber(
  tenantId: string
): Promise<string> {
  try {
    const today = new Date();
    const dateString = today
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
      .replace(/\//g, ""); // Format: DDMMYY

    // Get the highest order number for today for this tenant
    const query = `
      SELECT "orderNumber" 
      FROM orders 
      WHERE "tenantId" = $1 
        AND DATE("createdAt") = DATE($2)
        AND "orderNumber" ~ '^${dateString}-[0-9]+$'
      ORDER BY CAST(SUBSTRING("orderNumber" FROM '^${dateString}-([0-9]+)$') AS INTEGER) DESC
      LIMIT 1
    `;

    const result = await executeQuery(query, [tenantId, today]);

    let nextNumber = 1;
    if (result.rows.length > 0) {
      const lastOrderNumber = result.rows[0].orderNumber;
      const match = lastOrderNumber.match(
        new RegExp(`^${dateString}-([0-9]+)$`)
      );
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    // Format: DDMMYY-XXX (e.g., 151224-001, 151224-002)
    const formattedNumber = nextNumber.toString().padStart(3, "0");
    return `${dateString}-${formattedNumber}`;
  } catch (error) {
    // Fallback to timestamp-based if there's an error
    logger.error("Error generating sequential order number:", error);
    return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }
}

export function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Extract sequential number from orderNumber
 * @param orderNumber - Full order number (e.g., "160825-001", "ORD-1234567890")
 * @returns string - Sequential number (e.g., "001") or original if not in new format
 */
export function extractSequentialNumber(orderNumber: string): string {
  if (!orderNumber) return orderNumber;

  // Check if it's in the new format: DDMMYY-XXX
  const newFormatMatch = orderNumber.match(/^\d{6}-(\d{3})$/);
  if (newFormatMatch && newFormatMatch[1]) {
    return newFormatMatch[1]; // Return just the sequential part (e.g., "001")
  }

  // For old format orders, return the original orderNumber
  return orderNumber;
}
