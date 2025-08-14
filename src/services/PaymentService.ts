import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";
import { OrderService } from "./OrderService";

export interface PaymentData {
  orderId: string;
  tenantId: string;
  amount: number;
  paymentMethod: string;
  paidByUserId?: string;
  paidByUserName?: string;
  transactionId?: string;
  notes?: string;
}

export interface PaymentFilters {
  paymentMethod?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
}

export class PaymentService {
  /**
   * Process payment for an order
   */
  static async processPayment(paymentData: PaymentData) {
    const {
      orderId,
      tenantId,
      amount,
      paymentMethod,
      paidByUserId,
      paidByUserName,
      transactionId,
      notes,
    } = paymentData;

    // Validate required fields
    if (!orderId || !tenantId || !amount || !paymentMethod) {
      throw new Error(
        "Order ID, tenant ID, amount, and payment method are required"
      );
    }

    // Verify order exists and belongs to tenant
    const orderCheck = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [orderId, tenantId]
    );

    if (orderCheck.rows.length === 0) {
      throw new Error("Order not found or access denied");
    }

    const order = orderCheck.rows[0];

    // Check if order is already paid
    if (order.paymentStatus === "paid") {
      throw new Error("Order is already paid");
    }

    // Validate payment amount
    if (amount < order.finalAmount) {
      throw new Error("Payment amount cannot be less than order total");
    }

    // Generate payment ID
    const paymentId = `payment_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    // Create payment record
    const paymentQuery = `
      INSERT INTO payments (
        id, "orderId", "tenantId", amount, "paymentMethod", "paidByUserId", 
        "paidByUserName", "transactionId", notes, status, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const now = new Date();
    const paymentResult = await executeQuery(paymentQuery, [
      paymentId,
      orderId,
      tenantId,
      amount,
      paymentMethod,
      paidByUserId || "",
      paidByUserName || "",
      transactionId || "",
      notes || "",
      "completed",
      now,
      now,
    ]);

    const payment = paymentResult.rows[0];

    // Update order payment status
    const orderUpdates: any = {
      paymentStatus: "paid",
      paymentMethod,
    };

    if (paidByUserId) {
      orderUpdates.paidByUserId = paidByUserId;
    }

    await OrderService.updateOrder(orderId, tenantId, orderUpdates);

    // Update table status if order was on a table
    if (order.tableNumber) {
      try {
        const { TableService } = await import("./TableService");
        await TableService.assignOrderToTable(
          order.tableNumber,
          tenantId,
          orderId
        );
      } catch (error) {
        logger.warn("Failed to update table status:", error);
      }
    }

    logger.info(
      `Payment processed: ${paymentId} - Order: ${orderId} - Amount: $${amount}`
    );
    return payment;
  }

  /**
   * Get payment by ID
   */
  static async getPayment(paymentId: string, tenantId: string) {
    const result = await executeQuery(
      'SELECT * FROM payments WHERE id = $1 AND "tenantId" = $2',
      [paymentId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Payment not found");
    }

    return result.rows[0];
  }

  /**
   * Get payments for an order
   */
  static async getOrderPayments(orderId: string, tenantId: string) {
    const result = await executeQuery(
      'SELECT * FROM payments WHERE "orderId" = $1 AND "tenantId" = $2 ORDER BY "createdAt" DESC',
      [orderId, tenantId]
    );

    return result.rows;
  }

  /**
   * Get all payments for a tenant with filters
   */
  static async getPayments(tenantId: string, filters: PaymentFilters = {}) {
    let query = `
      SELECT p.*, o."orderNumber", o."customerName", o."tableNumber"
      FROM payments p
      LEFT JOIN orders o ON p."orderId" = o.id
      WHERE p."tenantId" = $1
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.paymentMethod) {
      query += ` AND p."paymentMethod" = $${paramIndex++}`;
      values.push(filters.paymentMethod);
    }

    if (filters.status) {
      query += ` AND p.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.startDate) {
      query += ` AND p."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND p."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    if (filters.minAmount) {
      query += ` AND p.amount >= $${paramIndex++}`;
      values.push(filters.minAmount.toString());
    }

    if (filters.maxAmount) {
      query += ` AND p.amount <= $${paramIndex++}`;
      values.push(filters.maxAmount.toString());
    }

    query += ` ORDER BY p."createdAt" DESC`;

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Refund payment
   */
  static async refundPayment(
    paymentId: string,
    tenantId: string,
    refundAmount: number,
    reason: string
  ) {
    // Get payment details
    const payment = await this.getPayment(paymentId, tenantId);

    if (payment.status !== "completed") {
      throw new Error("Payment is not completed and cannot be refunded");
    }

    if (refundAmount > payment.amount) {
      throw new Error("Refund amount cannot exceed payment amount");
    }

    // Generate refund ID
    const refundId = `refund_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    // Create refund record
    const refundQuery = `
      INSERT INTO refunds (
        id, "paymentId", "tenantId", amount, reason, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const now = new Date();
    const refundResult = await executeQuery(refundQuery, [
      refundId,
      paymentId,
      tenantId,
      refundAmount,
      reason,
      now,
    ]);

    const refund = refundResult.rows[0];

    // Update payment status if fully refunded
    if (refundAmount === payment.amount) {
      await executeQuery(
        'UPDATE payments SET status = $1, "updatedAt" = $2 WHERE id = $3',
        ["refunded", now, paymentId]
      );
    }

    logger.info(
      `Refund processed: ${refundId} - Payment: ${paymentId} - Amount: $${refundAmount}`
    );
    return refund;
  }

  /**
   * Get payment summary for a tenant
   */
  static async getPaymentSummary(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    let query = `
      SELECT 
        COUNT(*) as total_payments,
        SUM(amount) as total_amount,
        "paymentMethod",
        DATE("createdAt") as payment_date
      FROM payments 
      WHERE "tenantId" = $1 AND status = 'completed'
    `;

    const values = [tenantId];

    if (startDate) {
      query += ` AND "createdAt" >= $2`;
      values.push(startDate.toISOString());
    }

    if (endDate) {
      query += ` AND "createdAt" <= $3`;
      values.push(endDate.toISOString());
    }

    query += ` GROUP BY "paymentMethod", DATE("createdAt") ORDER BY payment_date DESC`;

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Get daily payment totals
   */
  static async getDailyPaymentTotals(tenantId: string, days: number = 30) {
    const query = `
      SELECT 
        DATE("createdAt") as date,
        COUNT(*) as payment_count,
        SUM(amount) as total_amount,
        AVG(amount) as average_amount
      FROM payments 
      WHERE "tenantId" = $1 
        AND status = 'completed'
        AND "createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `;

    const result = await executeQuery(query, [tenantId]);
    return result.rows;
  }

  /**
   * Validate payment method
   */
  static validatePaymentMethod(paymentMethod: string): boolean {
    const validMethods = [
      "cash",
      "card",
      "credit_card",
      "debit_card",
      "mobile_payment",
      "digital_wallet",
      "bank_transfer",
      "check",
      "gift_card",
      "loyalty_points",
    ];

    return validMethods.includes(paymentMethod.toLowerCase());
  }

  /**
   * Calculate change amount
   */
  static calculateChange(paymentAmount: number, orderTotal: number): number {
    return Math.max(0, paymentAmount - orderTotal);
  }
}
