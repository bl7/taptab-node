import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";
import {
  formatOrderFromRows,
  getOrderWithItemsQuery,
  generateSequentialOrderNumber,
} from "../routes/v1/orders/helpers/order-formatters";

export interface CreateOrderData {
  customerName?: string;
  customerPhone?: string;
  specialInstructions?: string;
  tableNumber?: string;
  tenantId: string;
  createdByUserId?: string;
  createdByUserName?: string;
  orderItems: Array<{
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    notes?: string;
  }>;
  isDelivery?: boolean;
  deliveryAddress?: string;
  estimatedDeliveryTime?: Date;
  paymentMethod?: string;
  taxAmount?: number;
  discountAmount?: number;
  orderSource?: string;
  sourceDetails?: string;
}

export interface UpdateOrderData {
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paidByUserId?: string;
  specialInstructions?: string;
  tableNumber?: string;
}

export class OrderService {
  /**
   * Create a new order with items
   */
  static async createOrder(orderData: CreateOrderData) {
    const {
      customerName,
      customerPhone,
      specialInstructions,
      tableNumber,
      tenantId,
      createdByUserId,
      createdByUserName,
      orderItems,
      isDelivery = false,
      deliveryAddress,
      estimatedDeliveryTime,
      paymentMethod,
      taxAmount = 0,
      discountAmount = 0,
      orderSource,
      sourceDetails,
    } = orderData;

    // Validate required fields
    if (!tenantId) {
      throw new Error("Tenant ID is required");
    }

    if (!orderItems || orderItems.length === 0) {
      throw new Error("Order must contain at least one item");
    }

    // Generate order ID
    const orderId = `order_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    // Calculate totals
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const finalAmount = subtotal + taxAmount - discountAmount;

    // Generate sequential daily order number
    const orderNumber = await generateSequentialOrderNumber(tenantId);
    const now = new Date();

    // Create order
    const orderQuery = `
      INSERT INTO orders (
        id, "orderNumber", "customerName", "customerPhone", "specialInstructions",
        "tableNumber", "tenantId", "createdByUserId", "createdByUserName", status,
        "totalAmount", "taxAmount", "discountAmount", "finalAmount", "isDelivery",
        "deliveryAddress", "estimatedDeliveryTime", "paymentMethod", "orderSource", "sourceDetails",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `;

    await executeQuery(orderQuery, [
      orderId,
      orderNumber,
      customerName || "",
      customerPhone || "",
      specialInstructions || "",
      tableNumber || "",
      tenantId,
      createdByUserId || "",
      createdByUserName || "",
      "pending",
      subtotal,
      taxAmount,
      discountAmount,
      finalAmount,
      isDelivery,
      deliveryAddress || "",
      estimatedDeliveryTime || null,
      paymentMethod || "",
      orderSource || "",
      sourceDetails || "",
      now,
      now,
    ]);

    // const order = orderResult.rows[0];

    // Create order items
    const orderItemsData = [];
    for (const item of orderItems) {
      const orderItemId = `oi_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`;
      const totalPrice = item.quantity * item.unitPrice;

      const orderItemQuery = `
        INSERT INTO "orderItems" (
          id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const orderItemResult = await executeQuery(orderItemQuery, [
        orderItemId,
        orderId,
        item.menuItemId,
        item.quantity,
        item.unitPrice,
        totalPrice,
        item.notes || "",
        now,
        now,
      ]);

      orderItemsData.push(orderItemResult.rows[0]);
    }

    // Get formatted order with items
    const formattedOrder = await this.getOrderWithItems(orderId);

    // Note: WebSocket notification will be sent when order becomes active after payment
    // This prevents premature notifications for pending orders
    logger.info(
      `Order created: ${orderId} - Total: $${finalAmount} - Status: ${formattedOrder.status}`
    );
    return formattedOrder;
  }

  /**
   * Get order with items by ID
   */
  static async getOrderWithItems(orderId: string) {
    const result = await executeQuery(getOrderWithItemsQuery(), [orderId]);
    return formatOrderFromRows(result.rows);
  }

  /**
   * Update order status and details
   */
  static async updateOrder(
    orderId: string,
    tenantId: string,
    updates: UpdateOrderData
  ) {
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (updates.status !== undefined) {
      updateFields.push(`"status" = $${paramIndex++}`);
      values.push(updates.status);
    }

    if (updates.paymentStatus !== undefined) {
      updateFields.push(`"paymentStatus" = $${paramIndex++}`);
      values.push(updates.paymentStatus);
    }

    if (updates.paymentMethod !== undefined) {
      updateFields.push(`"paymentMethod" = $${paramIndex++}`);
      values.push(updates.paymentMethod);
    }

    if (updates.paidByUserId !== undefined) {
      updateFields.push(`"paidByUserId" = $${paramIndex++}`);
      values.push(updates.paidByUserId);
    }

    if (updates.specialInstructions !== undefined) {
      updateFields.push(`"specialInstructions" = $${paramIndex++}`);
      values.push(updates.specialInstructions);
    }

    if (updates.tableNumber !== undefined) {
      updateFields.push(`"tableNumber" = $${paramIndex++}`);
      values.push(updates.tableNumber);
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    updateFields.push(`"updatedAt" = $${paramIndex++}`);
    values.push(new Date());

    // Add WHERE clause parameters
    values.push(orderId);
    values.push(tenantId);

    const updateQuery = `
      UPDATE orders 
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex++} AND "tenantId" = $${paramIndex++}
      RETURNING *
    `;

    const result = await executeQuery(updateQuery, values);

    if (result.rows.length === 0) {
      throw new Error("Order not found or access denied");
    }

    const updatedOrder = await this.getOrderWithItems(orderId);
    logger.info(`Order updated: ${orderId}`);
    return updatedOrder;
  }

  /**
   * Delete order by ID
   */
  static async deleteOrder(orderId: string, tenantId: string) {
    // First delete order items
    await executeQuery('DELETE FROM "orderItems" WHERE "orderId" = $1', [
      orderId,
    ]);

    // Then delete the order
    const result = await executeQuery(
      'DELETE FROM orders WHERE id = $1 AND "tenantId" = $2 RETURNING id',
      [orderId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Order not found or access denied");
    }

    logger.info(`Order deleted: ${orderId}`);
    return { success: true, orderId };
  }

  /**
   * Get all orders for a tenant
   */
  static async getOrders(
    tenantId: string,
    filters: {
      status?: string;
      tableNumber?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    let query = `
      SELECT o.*, 
             COUNT(oi.id) as item_count,
             SUM(oi.quantity) as total_items
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      WHERE o."tenantId" = $1
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.status) {
      query += ` AND o.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.tableNumber) {
      query += ` AND o."tableNumber" = $${paramIndex++}`;
      values.push(filters.tableNumber);
    }

    query += ` GROUP BY o.id ORDER BY o."createdAt" DESC`;

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit.toString());
    }

    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(filters.offset.toString());
    }

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Mark order as paid
   */
  static async markOrderAsPaid(
    orderId: string,
    tenantId: string,
    paymentMethod: string,
    paidByUserId?: string
  ) {
    const updates: UpdateOrderData = {
      paymentStatus: "paid",
      paymentMethod,
    };

    if (paidByUserId) {
      updates.paidByUserId = paidByUserId;
    }

    const updatedOrder = await this.updateOrder(orderId, tenantId, updates);

    // Emit payment event
    try {
      // socketManager.emitOrderPaid(tenantId, updatedOrder, paymentMethod, paidByUserId || "Unknown");
      logger.info(
        `Order marked as paid: ${orderId} - Method: ${paymentMethod}`
      );
    } catch (error) {
      logger.error("Failed to emit payment event:", error);
    }

    return updatedOrder;
  }
}
