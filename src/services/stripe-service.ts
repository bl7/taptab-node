import Stripe from "stripe";
import { logger } from "../utils/logger";
import { executeQuery } from "../utils/database";
import { socketManager } from "../utils/socket";

// Helper function to format order with items
export function formatOrderWithItems(rows: any[]) {
  if (rows.length === 0) return null;

  const firstRow = rows[0];
  const items = rows
    .filter((row) => row.menuItemId)
    .map((row) => ({
      id: row.menuItemId, // Use menuItemId as item id
      menuItemId: row.menuItemId,
      menuItemName: row.menu_item_name || "Unknown Item",
      quantity: row.quantity || 0,
      price: row.unitPrice ? parseFloat(row.unitPrice.toString()) : 0,
      total:
        row.unitPrice && row.quantity
          ? parseFloat((row.unitPrice * row.quantity).toString())
          : 0,
      notes: row.notes || "",
    }));

  return {
    id: firstRow.id,
    orderNumber: firstRow.orderNumber,
    tableNumber: firstRow.tableNumber,
    totalAmount: firstRow.totalAmount
      ? parseFloat(firstRow.totalAmount.toString())
      : 0,
    finalAmount: firstRow.finalAmount
      ? parseFloat(firstRow.finalAmount.toString())
      : 0,
    status: firstRow.status,
    paymentStatus: firstRow.paymentStatus,
    paymentMethod: firstRow.paymentMethod,
    customerName: firstRow.customerName,
    customerPhone: firstRow.customerPhone,
    orderSource: firstRow.orderSource,
    items,
    createdAt: firstRow.createdAt,
    updatedAt: firstRow.updatedAt,
  };
}

export class StripeService {
  /**
   * Get tenant's Stripe configuration
   */
  async getTenantStripeConfig(tenantId: string) {
    try {
      const result = await executeQuery(
        `SELECT 
          stripe_publishable_key,
          stripe_secret_key,
          webhook_secret,
          currency,
          merchant_name,
          merchant_country,
          is_stripe_enabled,
          apple_pay_enabled,
          google_pay_enabled,
          merchant_id,
          merchant_capabilities
        FROM tenant_payment_configs 
        WHERE "tenantId" = $1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant payment configuration not found");
      }

      const config = result.rows[0];

      return {
        publishableKey: config.stripe_publishable_key,
        secretKey: config.stripe_secret_key,
        webhookSecret: config.webhook_secret,
        currency: config.currency || "usd",
        merchantName: config.merchant_name,
        merchantCountry: config.merchant_country || "US",
        isStripeEnabled: config.is_stripe_enabled,
        applePayEnabled: config.apple_pay_enabled,
        googlePayEnabled: config.google_pay_enabled,
        merchantId: config.merchant_id,
        merchantCapabilities: config.merchant_capabilities || [],
      };
    } catch (error) {
      logger.error("Error getting tenant Stripe config:", error);
      throw error;
    }
  }

  /**
   * Get tenant-specific Stripe instance
   */
  private async getTenantStripe(tenantId: string): Promise<Stripe> {
    const config = await this.getTenantStripeConfig(tenantId);

    if (!config.secretKey) {
      throw new Error("Tenant Stripe secret key not configured");
    }

    return new Stripe(config.secretKey, {
      apiVersion: "2023-10-16",
    });
  }

  /**
   * Create a payment intent for an order
   */
  async createPaymentIntent(data: {
    tenantId: string;
    amount: number;
    currency: string;
    orderId: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  }) {
    try {
      // Get tenant's Stripe configuration
      const tenantConfig = await this.getTenantStripeConfig(data.tenantId);

      if (!tenantConfig.isStripeEnabled) {
        throw new Error("Stripe is not enabled for this tenant");
      }

      // Get tenant-specific Stripe instance
      const stripe = await this.getTenantStripe(data.tenantId);

      // Create payment intent with tenant's Stripe account
      const paymentIntent = await stripe.paymentIntents.create({
        amount: data.amount,
        currency: data.currency,
        metadata: {
          tenantId: data.tenantId,
          orderId: data.orderId,
          ...(data.customerEmail && { customerEmail: data.customerEmail }),
          ...data.metadata,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      // Store payment record in database
      await executeQuery(
        `INSERT INTO order_payments (
          order_id, 
          "tenantId", 
          payment_intent_id, 
          amount, 
          currency, 
          status, 
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.orderId,
          data.tenantId,
          paymentIntent.id,
          data.amount,
          data.currency,
          "pending",
          JSON.stringify(data.metadata || {}),
        ]
      );

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: data.amount,
        currency: data.currency,
      };
    } catch (error) {
      logger.error("Error creating payment intent:", error);
      throw error;
    }
  }

  /**
   * Confirm payment after successful frontend processing
   */
  static async confirmPayment(data: {
    orderId: string;
    tenantId: string;
    paymentIntentId: string;
    paymentMethod: string;
  }) {
    try {
      logger.info(`🔍 StripeService.confirmPayment called with data:`, data);

      // First, get the order to check its orderSource
      const orderResult = await executeQuery(
        `SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2`,
        [data.orderId, data.tenantId]
      );

      if (orderResult.rows.length === 0) {
        logger.error(`❌ Order ${data.orderId} not found`);
        throw new Error("Order not found");
      }

      const order = orderResult.rows[0];
      logger.info(`📦 Found order:`, order);

      // Update order_payments table
      const paymentUpdateResult = await executeQuery(
        `UPDATE order_payments 
         SET status = $1, "updatedAt" = $2 
         WHERE "orderId" = $3 AND "tenantId" = $4`,
        ["confirmed", new Date(), data.orderId, data.tenantId]
      );

      logger.info(`✅ Payment record updated:`, paymentUpdateResult.rowCount);

      // Determine new status based on orderSource
      const isQROrder = order.orderSource === "QR_ORDERING";
      const newStatus = isQROrder ? "active" : "closed"; // QR orders stay active, regular orders become closed

      // Update orders table
      const orderUpdateResult = await executeQuery(
        `UPDATE orders 
         SET status = $1,
             "paymentStatus" = $2, 
             "paymentMethod" = $3, 
             "paidAt" = $4, 
             "updatedAt" = $5 
         WHERE id = $6 AND "tenantId" = $7 AND status = 'pending'`,
        [
          newStatus,
          "paid",
          "STRIPE",
          new Date(),
          new Date(),
          data.orderId,
          data.tenantId,
        ]
      );

      logger.info(`✅ Order updated:`, orderUpdateResult.rowCount);

      if (orderUpdateResult.rowCount === 0) {
        logger.error(`❌ No order was updated - order may not be active`);
        throw new Error("Order not found or not active");
      }

      // Get the updated order for WebSocket notification
      const updatedOrderResult = await executeQuery(
        `SELECT o.*, 
                oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
                mi.name as menu_item_name,
                u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
         FROM orders o
         LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
         LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
         LEFT JOIN users u ON o."createdById" = u.id
         WHERE o.id = $1`,
        [data.orderId]
      );

      if (updatedOrderResult.rows.length > 0) {
        const formattedOrder = formatOrderWithItems(updatedOrderResult.rows);
        logger.info(`📦 Formatted order for WebSocket:`, formattedOrder);

        // Only emit WebSocket notification if order is still active (QR orders)
        if (formattedOrder && formattedOrder.status === "active") {
          try {
            socketManager.emitNewOrder(data.tenantId, formattedOrder);
            logger.info(
              `✅ WebSocket notification sent for order ${data.orderId}`
            );
          } catch (error) {
            logger.error("❌ Failed to emit WebSocket event:", error);
          }
        } else {
          logger.info(
            `📝 Order ${data.orderId} is now ${
              formattedOrder?.status || "unknown"
            } - no WebSocket notification needed`
          );
        }
      }

      return {
        success: true,
        orderId: data.orderId,
        paymentIntentId: data.paymentIntentId,
        status: newStatus,
        paymentStatus: "paid",
        paymentMethod: "STRIPE",
      };
    } catch (error) {
      logger.error("❌ Error in confirmPayment:", error);
      throw error;
    }
  }

  /**
   * Get payment status for an order
   */
  async getPaymentStatus(orderId: string, tenantId: string) {
    try {
      const result = await executeQuery(
        `SELECT 
          status,
          payment_intent_id,
          amount,
          currency,
          payment_method,
          stripe_payment_method_id,
          metadata,
          created_at,
          updated_at
        FROM order_payments 
        WHERE order_id = $1 AND "tenantId" = $2`,
        [orderId, tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error("Payment record not found");
      }

      return result.rows[0];
    } catch (error) {
      logger.error("Error getting payment status:", error);
      throw error;
    }
  }

  // ========================================
  // ADMIN METHODS (Protected Routes)
  // ========================================

  async createOrUpdateTenantConfig(config: {
    tenantId: string;
    stripePublishableKey: string;
    stripeSecretKey: string;
    webhookSecret: string;
    currency?: string;
    merchantName?: string;
    merchantCountry?: string;
    applePayEnabled?: boolean;
    googlePayEnabled?: boolean;
    merchantId?: string;
    merchantCapabilities?: string[];
    isStripeEnabled?: boolean;
  }) {
    try {
      logger.info(`🔍 Looking up tenant with ID: ${config.tenantId}`);

      // First check if tenant exists - try multiple approaches
      let tenantCheck = await executeQuery(
        `SELECT id FROM tenants WHERE id = $1`,
        [config.tenantId]
      );

      if (tenantCheck.rows.length === 0) {
        // Try looking up by slug as fallback
        logger.info(
          `🔍 Tenant not found by ID, trying slug: ${config.tenantId}`
        );
        tenantCheck = await executeQuery(
          `SELECT id FROM tenants WHERE slug = $1`,
          [config.tenantId]
        );
      }

      if (tenantCheck.rows.length === 0) {
        // Try looking up by name as fallback
        logger.info(
          `🔍 Tenant not found by slug, trying name: ${config.tenantId}`
        );
        tenantCheck = await executeQuery(
          `SELECT id FROM tenants WHERE name ILIKE $1`,
          [`%${config.tenantId}%`]
        );
      }

      if (tenantCheck.rows.length === 0) {
        logger.error(
          `❌ Tenant not found with any method for: ${config.tenantId}`
        );
        throw new Error("Tenant not found");
      }

      const actualTenantId = tenantCheck.rows[0].id;
      logger.info(`✅ Found tenant with actual ID: ${actualTenantId}`);

      // Check if config already exists
      const existingConfig = await executeQuery(
        `SELECT id FROM tenant_payment_configs WHERE "tenantId" = $1`,
        [actualTenantId]
      );

      if (existingConfig.rows.length > 0) {
        // Update existing config
        const result = await executeQuery(
          `UPDATE tenant_payment_configs SET
            stripe_publishable_key = $1,
            stripe_secret_key = $2,
            webhook_secret = $3,
            currency = $4,
            merchant_name = $5,
            merchant_country = $6,
            apple_pay_enabled = $7,
            google_pay_enabled = $8,
            merchant_id = $9,
            merchant_capabilities = $10,
            is_stripe_enabled = $11,
            updated_at = NOW()
          WHERE "tenantId" = $12
          RETURNING *`,
          [
            config.stripePublishableKey,
            config.stripeSecretKey,
            config.webhookSecret,
            config.currency || "usd",
            config.merchantName,
            config.merchantCountry || "US",
            config.applePayEnabled || false,
            config.googlePayEnabled || false,
            config.merchantId,
            config.merchantCapabilities || [],
            config.isStripeEnabled !== false,
            actualTenantId,
          ]
        );

        return result.rows[0];
      } else {
        // Create new config
        const result = await executeQuery(
          `INSERT INTO tenant_payment_configs (
            "tenantId",
            stripe_publishable_key,
            stripe_secret_key,
            webhook_secret,
            currency,
            merchant_name,
            merchant_country,
            apple_pay_enabled,
            google_pay_enabled,
            merchant_id,
            merchant_capabilities,
            is_stripe_enabled
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *`,
          [
            actualTenantId,
            config.stripePublishableKey,
            config.stripeSecretKey,
            config.webhookSecret,
            config.currency || "usd",
            config.merchantName,
            config.merchantCountry || "US",
            config.applePayEnabled || false,
            config.googlePayEnabled || false,
            config.merchantId,
            config.merchantCapabilities || [],
            config.isStripeEnabled !== false,
          ]
        );

        return result.rows[0];
      }
    } catch (error) {
      logger.error("Error creating/updating tenant config:", error);
      throw error;
    }
  }

  async deleteTenantConfig(tenantId: string) {
    try {
      const result = await executeQuery(
        `DELETE FROM tenant_payment_configs WHERE "tenantId" = $1 RETURNING id`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error("Tenant payment configuration not found");
      }

      return result.rows[0];
    } catch (error) {
      logger.error("Error deleting tenant config:", error);
      throw error;
    }
  }

  /**
   * Test Stripe connection by creating a test payment intent
   */
  async testStripeConnection(tenantId: string) {
    try {
      logger.info(`🧪 Testing Stripe connection for tenant: ${tenantId}`);

      // Get tenant's Stripe configuration
      const config = await this.getTenantStripeConfig(tenantId);

      if (!config.isStripeEnabled) {
        throw new Error("Stripe is not enabled for this tenant");
      }

      // Create Stripe instance with tenant's secret key
      const stripe = new Stripe(config.secretKey, {
        apiVersion: "2023-10-16",
      });

      // Test 1: Verify API key by making a simple API call
      logger.info(`🧪 Testing API key validity...`);
      const account = await stripe.accounts.retrieve();

      logger.info(`✅ API key valid. Account ID: ${account.id}`);

      // Test 2: Create a test payment intent (will be immediately canceled)
      logger.info(`🧪 Creating test payment intent...`);
      const testPaymentIntent = await stripe.paymentIntents.create({
        amount: 100, // $1.00
        currency: config.currency || "usd",
        metadata: {
          test: "true",
          tenantId: tenantId,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      logger.info(`✅ Test payment intent created: ${testPaymentIntent.id}`);

      // Test 3: Cancel the test payment intent
      logger.info(`🧪 Canceling test payment intent...`);
      await stripe.paymentIntents.cancel(testPaymentIntent.id);

      logger.info(`✅ Test payment intent canceled successfully`);

      return {
        success: true,
        accountId: account.id,
        testPaymentIntentId: testPaymentIntent.id,
        currency: config.currency,
        publishableKey: config.publishableKey,
        message: "Stripe connection test successful",
      };
    } catch (error: any) {
      logger.error("Error testing Stripe connection:", error);

      if (error.type === "StripeAuthenticationError") {
        throw new Error("Invalid API key provided");
      }

      if (error.type === "StripeInvalidRequestError") {
        throw new Error("Invalid Stripe configuration");
      }

      throw error;
    }
  }

  /**
   * Handle Stripe webhook events for specific tenant
   */
  async handleWebhookEvent(event: Stripe.Event, tenantId: string) {
    try {
      switch (event.type) {
        case "payment_intent.succeeded":
          await this.handlePaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
            tenantId
          );
          break;
        case "payment_intent.payment_failed":
          await this.handlePaymentIntentFailed(
            event.data.object as Stripe.PaymentIntent,
            tenantId
          );
          break;
        case "payment_intent.canceled":
          await this.handlePaymentIntentCanceled(
            event.data.object as Stripe.PaymentIntent,
            tenantId
          );
          break;
        default:
          logger.info(`Unhandled webhook event type: ${event.type}`);
      }
    } catch (error) {
      logger.error("Error handling webhook event:", error);
      throw error;
    }
  }

  private async handlePaymentIntentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
    tenantId: string
  ) {
    try {
      logger.info(
        `🔍 StripeService.handlePaymentIntentSucceeded called with:`,
        paymentIntent.id
      );

      const orderId = paymentIntent.metadata?.["orderId"];

      if (!orderId) {
        logger.error(`❌ Missing orderId in payment intent metadata`);
        return;
      }

      // Get the order to check its orderSource
      const orderResult = await executeQuery(
        `SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        logger.error(`❌ Order ${orderId} not found`);
        return;
      }

      const order = orderResult.rows[0];
      logger.info(`📦 Found order:`, order);

      // Update order_payments table
      const paymentUpdateResult = await executeQuery(
        `UPDATE order_payments 
         SET status = $1, "updatedAt" = $2 
         WHERE "orderId" = $3 AND "tenantId" = $4`,
        ["confirmed", new Date(), orderId, tenantId]
      );

      logger.info(`✅ Payment record updated:`, paymentUpdateResult.rowCount);

      // Determine new status based on orderSource
      const isQROrder = order.orderSource === "QR_ORDERING";
      const newStatus = isQROrder ? "active" : "closed"; // QR orders become active, regular orders become closed

      // Update orders table
      const orderUpdateResult = await executeQuery(
        `UPDATE orders 
         SET status = $1, "paymentStatus" = $2, "paymentMethod" = $3, "paidAt" = $4, "updatedAt" = $5
         WHERE id = $6 AND "tenantId" = $7 AND status = 'pending'`,
        [newStatus, "paid", "STRIPE", new Date(), new Date(), orderId, tenantId]
      );

      logger.info(`✅ Order updated:`, orderUpdateResult.rowCount);

      if (orderUpdateResult.rowCount === 0) {
        logger.error(`❌ No order was updated - order may not be pending`);
        return;
      }

      // Get the updated order for WebSocket notification
      const updatedOrderResult = await executeQuery(
        `SELECT o.*, 
                oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
                mi.name as menu_item_name,
                u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
         FROM orders o
         LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
         LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
         LEFT JOIN users u ON o."createdById" = u.id
         WHERE o.id = $1`,
        [orderId]
      );

      if (updatedOrderResult.rows.length > 0) {
        const formattedOrder = formatOrderWithItems(updatedOrderResult.rows);
        logger.info(`📦 Formatted order for WebSocket:`, formattedOrder);

        // Only emit WebSocket notification if order is now active (QR orders)
        if (formattedOrder && formattedOrder.status === "active") {
          try {
            socketManager.emitNewOrder(tenantId, formattedOrder);
            logger.info(`✅ WebSocket notification sent for order ${orderId}`);
          } catch (error) {
            logger.error("❌ Failed to emit WebSocket event:", error);
          }
        } else {
          logger.info(
            `📝 Order ${orderId} is now ${
              formattedOrder?.status || "unknown"
            } - no WebSocket notification needed`
          );
        }
      }

      logger.info(
        `✅ Payment intent succeeded handled successfully for order ${orderId}`
      );
    } catch (error) {
      logger.error("❌ Error in handlePaymentIntentSucceeded:", error);
    }
  }

  private async handlePaymentIntentFailed(
    paymentIntent: Stripe.PaymentIntent,
    tenantId: string
  ) {
    try {
      logger.info(
        `🔍 StripeService.handlePaymentIntentFailed called with:`,
        paymentIntent.id
      );

      const orderId = paymentIntent.metadata?.["orderId"];

      if (!orderId) {
        logger.error(`❌ Missing orderId in payment intent metadata`);
        return;
      }

      // Update order_payments table
      const paymentUpdateResult = await executeQuery(
        `UPDATE order_payments 
         SET status = $1, "updatedAt" = $2 
         WHERE "orderId" = $3 AND "tenantId" = $4`,
        ["failed", new Date(), orderId, tenantId]
      );

      logger.info(`✅ Payment record updated:`, paymentUpdateResult.rowCount);

      // Delete the pending order since payment failed
      const orderDeleteResult = await executeQuery(
        `DELETE FROM orders 
         WHERE id = $1 AND "tenantId" = $2 AND status = 'pending'`,
        [orderId, tenantId]
      );

      logger.info(`✅ Pending order deleted:`, orderDeleteResult.rowCount);

      logger.info(
        `✅ Payment intent failed handled successfully for order ${orderId}`
      );
    } catch (error) {
      logger.error("❌ Error in handlePaymentIntentFailed:", error);
    }
  }

  private async handlePaymentIntentCanceled(
    paymentIntent: Stripe.PaymentIntent,
    tenantId: string
  ) {
    try {
      logger.info(
        `🔍 StripeService.handlePaymentIntentCanceled called with:`,
        paymentIntent.id
      );

      const orderId = paymentIntent.metadata?.["orderId"];

      if (!orderId) {
        logger.error(`❌ Missing orderId in payment intent metadata`);
        return;
      }

      // Update order_payments table
      const paymentUpdateResult = await executeQuery(
        `UPDATE order_payments 
         SET status = $1, "updatedAt" = $2 
         WHERE "orderId" = $3 AND "tenantId" = $4`,
        ["failed", new Date(), orderId, tenantId]
      );

      logger.info(`✅ Payment record updated:`, paymentUpdateResult.rowCount);

      // Delete the pending order since payment was canceled
      const orderDeleteResult = await executeQuery(
        `DELETE FROM orders 
         WHERE id = $1 AND "tenantId" = $2 AND status = 'pending'`,
        [orderId, tenantId]
      );

      logger.info(`✅ Pending order deleted:`, orderDeleteResult.rowCount);

      logger.info(
        `✅ Payment intent canceled handled successfully for order ${orderId}`
      );
    } catch (error) {
      logger.error("❌ Error in handlePaymentIntentCanceled:", error);
    }
  }

  /**
   * Verify webhook signature for specific tenant
   */
  async verifyWebhookSignature(
    payload: string,
    signature: string,
    tenantId: string
  ): Promise<Stripe.Event> {
    const config = await this.getTenantStripeConfig(tenantId);

    if (!config.secretKey) {
      throw new Error("Tenant Stripe secret key not configured");
    }

    if (!config.webhookSecret) {
      throw new Error("Tenant webhook secret not configured");
    }

    try {
      const stripe = new Stripe(config.secretKey, {
        apiVersion: "2023-10-16",
      });

      return stripe.webhooks.constructEvent(
        payload,
        signature,
        config.webhookSecret
      );
    } catch (error) {
      logger.error("Webhook signature verification failed:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const stripeService = new StripeService();
