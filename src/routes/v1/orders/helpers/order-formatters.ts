// Helper functions for formatting order data consistently across all order operations

export function formatOrderFromRows(orderRows: any[]): any {
  if (orderRows.length === 0) return null;

  const firstRow = orderRows[0];

  return {
    id: firstRow.id,
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

export function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
}
