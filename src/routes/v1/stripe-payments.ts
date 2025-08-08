import { Router, Request, Response } from "express";
import { body, param, validationResult } from "express-validator";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { StripeService } from "../../services/stripe-service";
import { executeQuery } from "../../utils/database";
import { socketManager } from "../../utils/socket";

// Import the formatOrderWithItems function from stripe service
import { formatOrderWithItems } from "../../services/stripe-service";

const router = Router();
const stripeService = new StripeService();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      "VALIDATION_ERROR",
      "Invalid request data",
      400,
      errors.array()
    );
  }
  next();
};

// GET /api/v1/stripe/tenants/{tenantId}/config - PUBLIC (for customer payment)
router.get(
  "/stripe/tenants/:tenantId/config",
  [param("tenantId").notEmpty().withMessage("Tenant ID is required")],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;

      logger.info(`🔍 GET /api/v1/stripe/tenants/${tenantId}/config called`);
      logger.info(`📝 Request params:`, req.params);
      logger.info(`📝 Request headers:`, req.headers);

      const config = await stripeService.getTenantStripeConfig(tenantId);

      logger.info(`✅ Config found for tenant ${tenantId}`);
      sendSuccess(res, config, "Stripe configuration retrieved successfully");
    } catch (error: any) {
      logger.error("❌ Error getting Stripe config:", error);

      if (error.message === "Tenant payment configuration not found") {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      sendError(
        res,
        "STRIPE_CONFIG_ERROR",
        "Failed to get Stripe configuration",
        500
      );
    }
  }
);

// POST /api/v1/stripe/orders/create-payment-intent - PUBLIC (for customer payment)
router.post(
  "/stripe/orders/create-payment-intent",
  [
    body("tenantId").notEmpty().withMessage("Tenant ID is required"),
    body("amount")
      .isInt({ min: 1 })
      .withMessage("Amount must be a positive integer in cents"),
    body("currency")
      .isLength({ min: 3, max: 3 })
      .withMessage("Currency must be 3 characters"),
    body("orderId").notEmpty().withMessage("Order ID is required"),
    body("customerEmail")
      .optional()
      .isEmail()
      .withMessage("Customer email must be valid"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { tenantId, amount, currency, orderId, customerEmail, metadata } =
        req.body;

      logger.info(`🔍 POST /api/v1/stripe/orders/create-payment-intent called`);
      logger.info(`📝 Request body:`, req.body);
      logger.info(`📝 Request headers:`, req.headers);

      const paymentIntent = await stripeService.createPaymentIntent({
        tenantId,
        amount,
        currency,
        orderId,
        customerEmail,
        metadata,
      });

      logger.info(`✅ Payment intent created for order ${orderId}`);
      sendSuccess(res, paymentIntent, "Payment intent created successfully");
    } catch (error: any) {
      logger.error("❌ Error creating payment intent:", error);

      if (error.message === "Tenant payment configuration not found") {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      if (error.message === "Stripe is not enabled for this tenant") {
        return sendError(
          res,
          "STRIPE_DISABLED",
          "Stripe is not enabled for this tenant",
          400
        );
      }

      sendError(
        res,
        "PAYMENT_INTENT_ERROR",
        "Failed to create payment intent",
        500
      );
    }
  }
);

// POST /api/v1/stripe/orders/{orderId}/confirm-payment - PUBLIC (for customer payment)
router.post(
  "/stripe/orders/:orderId/confirm-payment",
  [
    param("orderId").notEmpty().withMessage("Order ID is required"),
    body("paymentIntentId")
      .notEmpty()
      .withMessage("Payment intent ID is required"),
    body("paymentMethod")
      .isIn(["card", "apple_pay", "google_pay"])
      .withMessage("Invalid payment method"),
    body("amount")
      .isInt({ min: 1 })
      .withMessage("Amount must be a positive integer in cents"),
    body("stripePaymentMethodId")
      .optional()
      .notEmpty()
      .withMessage("Stripe payment method ID cannot be empty if provided"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const {
        paymentIntentId,
        paymentMethod,
        amount,
        stripePaymentMethodId,
        tenantId,
      } = req.body;

      logger.info(
        `🔍 POST /api/v1/stripe/orders/${orderId}/confirm-payment called`
      );
      logger.info(`📝 Request params:`, req.params);
      logger.info(`📝 Request body:`, req.body);
      logger.info(`📝 Request headers:`, req.headers);

      // Get tenant ID from request body (since no auth)
      if (!tenantId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Tenant ID is required in request body",
          400
        );
      }

      const result = await StripeService.confirmPayment({
        orderId,
        tenantId,
        paymentIntentId,
        paymentMethod,
      });

      logger.info(`✅ Payment confirmed for order ${orderId}`);
      sendSuccess(res, result, "Payment confirmed successfully");
    } catch (error: any) {
      logger.error("❌ Error confirming payment:", error);

      if (error.message === "Payment record not found") {
        return sendError(res, "NOT_FOUND", "Payment record not found", 404);
      }

      if (error.message.includes("Payment intent status is")) {
        return sendError(res, "PAYMENT_FAILED", error.message, 402);
      }

      sendError(
        res,
        "PAYMENT_CONFIRMATION_ERROR",
        "Failed to confirm payment",
        500
      );
    }
  }
);

// POST /api/v1/stripe/orders/{orderId}/payment-success - PUBLIC (for frontend to call after successful payment)
router.post(
  "/stripe/orders/:orderId/payment-success",
  [
    param("orderId").notEmpty().withMessage("Order ID is required"),
    body("tenantId").notEmpty().withMessage("Tenant ID is required"),
    body("paymentIntentId")
      .notEmpty()
      .withMessage("Payment intent ID is required"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { tenantId, paymentIntentId } = req.body;

      logger.info(
        `🔍 POST /api/v1/stripe/orders/${orderId}/payment-success called`
      );
      logger.info(`📝 Request params:`, req.params);
      logger.info(`📝 Request body:`, req.body);

      // Get the order to check its orderSource
      const orderResult = await executeQuery(
        `SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return sendError(res, "ORDER_NOT_FOUND", "Order not found", 404);
      }

      const order = orderResult.rows[0];
      logger.info(`📦 Found order:`, order);

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
        [newStatus, "paid", "STRIPE", new Date(), new Date(), orderId, tenantId]
      );

      logger.info(`✅ Order updated:`, orderUpdateResult.rowCount);

      if (orderUpdateResult.rowCount === 0) {
        return sendError(
          res,
          "ORDER_NOT_FOUND",
          "Order not found or not pending",
          404
        );
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
        try {
          const formattedOrder = formatOrderWithItems(updatedOrderResult.rows);
          logger.info(`📦 Formatted order for WebSocket:`, formattedOrder);

          // Only emit WebSocket notification if order is now active (QR orders)
          if (formattedOrder && formattedOrder.status === "active") {
            try {
              socketManager.emitNewOrder(tenantId, formattedOrder);
              logger.info(
                `✅ WebSocket notification sent for order ${orderId}`
              );
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
        } catch (error) {
          logger.error("❌ Error formatting order for WebSocket:", error);
          // Don't fail the whole request if formatting fails
        }
      }

      logger.info(`✅ Payment success handled for order ${orderId}`);
      sendSuccess(
        res,
        {
          success: true,
          orderId,
          paymentIntentId,
          status: newStatus,
          paymentStatus: "paid",
          paymentMethod: "STRIPE",
        },
        "Payment success handled successfully"
      );
    } catch (error: any) {
      logger.error("❌ Error handling payment success:", error);
      sendError(
        res,
        "PAYMENT_SUCCESS_ERROR",
        "Failed to handle payment success",
        500
      );
    }
  }
);

// GET /api/v1/stripe/orders/{orderId}/payment-status - PUBLIC (for customer to check status)
router.get(
  "/stripe/orders/:orderId/payment-status",
  [param("orderId").notEmpty().withMessage("Order ID is required")],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { tenantId } = req.query; // Get tenantId from query params

      logger.info(
        `🔍 GET /api/v1/stripe/orders/${orderId}/payment-status called`
      );
      logger.info(`📝 Request params:`, req.params);
      logger.info(`📝 Request query:`, req.query);
      logger.info(`📝 Request headers:`, req.headers);

      if (!tenantId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Tenant ID is required in query params",
          400
        );
      }

      const paymentStatus = await stripeService.getPaymentStatus(
        orderId,
        tenantId as string
      );

      logger.info(`✅ Payment status retrieved for order ${orderId}`);
      sendSuccess(res, paymentStatus, "Payment status retrieved successfully");
    } catch (error: any) {
      logger.error("❌ Error getting payment status:", error);

      if (error.message === "Payment record not found") {
        return sendError(res, "NOT_FOUND", "Payment record not found", 404);
      }

      sendError(
        res,
        "PAYMENT_STATUS_ERROR",
        "Failed to get payment status",
        500
      );
    }
  }
);

// POST /api/v1/webhooks/stripe/{tenantId} - WEBHOOK (no auth needed)
router.post(
  "/webhooks/stripe/:tenantId",
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      const signature = req.headers["stripe-signature"] as string;

      if (!signature) {
        return sendError(
          res,
          "MISSING_SIGNATURE",
          "Stripe signature is required",
          400
        );
      }

      // Get raw body for webhook verification
      const rawBody = req.body as Buffer;
      const payload = rawBody.toString("utf8");

      // Verify webhook signature for specific tenant
      const event = await stripeService.verifyWebhookSignature(
        payload,
        signature,
        tenantId
      );

      // Handle the webhook event for specific tenant
      await stripeService.handleWebhookEvent(event, tenantId);

      // Return 200 to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error("Webhook error:", error);

      if (error.message.includes("No signatures found")) {
        return sendError(
          res,
          "INVALID_SIGNATURE",
          "Invalid webhook signature",
          400
        );
      }

      if (error.message === "Tenant payment configuration not found") {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      sendError(res, "WEBHOOK_ERROR", "Webhook processing failed", 500);
    }
  }
);

// ========================================
// PROTECTED ADMIN ROUTES (Require Authentication)
// ========================================

// POST /api/v1/stripe/admin/config - PROTECTED (Admin only)
router.post(
  "/stripe/admin/config",
  authenticateToken, // ✅ Requires authentication
  [
    body("publishableKey")
      .notEmpty()
      .withMessage("Stripe publishable key is required"),
    body("secretKey").notEmpty().withMessage("Stripe secret key is required"),
    body("webhookSecret").notEmpty().withMessage("Webhook secret is required"),
    body("currency")
      .optional()
      .isLength({ min: 3, max: 3 })
      .withMessage("Currency must be 3 characters"),
    body("merchantName")
      .optional()
      .notEmpty()
      .withMessage("Merchant name cannot be empty if provided"),
    body("merchantCountry")
      .optional()
      .isLength({ min: 2, max: 2 })
      .withMessage("Merchant country must be 2 characters"),
    body("applePayEnabled")
      .optional()
      .isBoolean()
      .withMessage("Apple Pay enabled must be boolean"),
    body("googlePayEnabled")
      .optional()
      .isBoolean()
      .withMessage("Google Pay enabled must be boolean"),
    body("merchantId")
      .optional()
      .notEmpty()
      .withMessage("Merchant ID cannot be empty if provided"),
    body("merchantCapabilities")
      .optional()
      .isArray()
      .withMessage("Merchant capabilities must be an array"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      // Get tenantId from authenticated user's JWT token
      const userTenantId = (req as any).user?.tenantId;

      if (!userTenantId) {
        return sendError(
          res,
          "UNAUTHORIZED",
          "No tenant ID found in authentication token",
          401
        );
      }

      const {
        publishableKey,
        secretKey,
        webhookSecret,
        currency = "usd",
        merchantName,
        merchantCountry = "US",
        applePayEnabled = false,
        googlePayEnabled = false,
        merchantId,
        merchantCapabilities = [],
        isStripeEnabled = true,
      } = req.body;

      logger.info(
        `🔍 POST /api/v1/stripe/admin/config called for tenant ${userTenantId}`
      );
      logger.info(`📝 Request body:`, req.body);
      logger.info(`📝 Request headers:`, req.headers);

      const result = await stripeService.createOrUpdateTenantConfig({
        tenantId: userTenantId,
        stripePublishableKey: publishableKey,
        stripeSecretKey: secretKey,
        webhookSecret,
        currency,
        merchantName,
        merchantCountry,
        applePayEnabled,
        googlePayEnabled,
        merchantId: merchantId || null, // Handle empty string
        merchantCapabilities,
        isStripeEnabled,
      });

      logger.info(`✅ Config saved for tenant ${userTenantId}`);
      sendSuccess(res, result, "Payment configuration saved successfully");
    } catch (error: any) {
      logger.error("❌ Error saving payment config:", error);

      if (error.message === "Tenant not found") {
        return sendError(res, "NOT_FOUND", "Tenant not found", 404);
      }

      sendError(
        res,
        "PAYMENT_CONFIG_ERROR",
        "Failed to save payment configuration",
        500
      );
    }
  }
);

// GET /api/v1/stripe/admin/config - PROTECTED (Admin only)
router.get(
  "/stripe/admin/config",
  authenticateToken, // ✅ Requires authentication
  async (req: Request, res: Response) => {
    try {
      // Get tenantId from authenticated user's JWT token
      const userTenantId = (req as any).user?.tenantId;

      if (!userTenantId) {
        return sendError(
          res,
          "UNAUTHORIZED",
          "No tenant ID found in authentication token",
          401
        );
      }

      logger.info(
        `🔍 GET /api/v1/stripe/admin/config called for tenant ${userTenantId}`
      );
      logger.info(`📝 Request headers:`, req.headers);

      const config = await stripeService.getTenantStripeConfig(userTenantId);

      logger.info(`✅ Config retrieved for tenant ${userTenantId}`);
      sendSuccess(res, config, "Payment configuration retrieved successfully");
    } catch (error: any) {
      logger.error("❌ Error getting payment config:", error);

      if (error.message === "Tenant payment configuration not found") {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      sendError(
        res,
        "PAYMENT_CONFIG_ERROR",
        "Failed to get payment configuration",
        500
      );
    }
  }
);

// DELETE /api/v1/stripe/admin/config - PROTECTED (Admin only)
router.delete(
  "/stripe/admin/config",
  authenticateToken, // ✅ Requires authentication
  async (req: Request, res: Response) => {
    try {
      // Get tenantId from authenticated user's JWT token
      const userTenantId = (req as any).user?.tenantId;

      if (!userTenantId) {
        return sendError(
          res,
          "UNAUTHORIZED",
          "No tenant ID found in authentication token",
          401
        );
      }

      logger.info(
        `🔍 DELETE /api/v1/stripe/admin/config called for tenant ${userTenantId}`
      );
      logger.info(`📝 Request headers:`, req.headers);

      await stripeService.deleteTenantConfig(userTenantId);

      logger.info(`✅ Config deleted for tenant ${userTenantId}`);
      sendSuccess(res, null, "Payment configuration deleted successfully");
    } catch (error: any) {
      logger.error("❌ Error deleting payment config:", error);

      if (error.message === "Tenant payment configuration not found") {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      sendError(
        res,
        "PAYMENT_CONFIG_ERROR",
        "Failed to delete payment configuration",
        500
      );
    }
  }
);

// POST /api/v1/stripe/admin/test-connection - PROTECTED (Admin only)
router.post(
  "/stripe/admin/test-connection",
  authenticateToken, // ✅ Requires authentication
  async (req: Request, res: Response) => {
    try {
      // Get tenantId from authenticated user's JWT token
      const userTenantId = (req as any).user?.tenantId;

      if (!userTenantId) {
        return sendError(
          res,
          "UNAUTHORIZED",
          "No tenant ID found in authentication token",
          401
        );
      }

      logger.info(
        `🔍 POST /api/v1/stripe/admin/test-connection called for tenant ${userTenantId}`
      );

      // Test the Stripe connection
      const testResult = await stripeService.testStripeConnection(userTenantId);

      logger.info(
        `✅ Stripe connection test successful for tenant ${userTenantId}`
      );
      sendSuccess(res, testResult, "Stripe connection test successful");
    } catch (error: any) {
      logger.error("❌ Error testing Stripe connection:", error);

      if (error.message.includes("Tenant payment configuration not found")) {
        return sendError(
          res,
          "NOT_FOUND",
          "Tenant payment configuration not found",
          404
        );
      }

      if (error.message.includes("Invalid API key")) {
        return sendError(
          res,
          "STRIPE_CONFIG_ERROR",
          "Invalid Stripe API keys",
          400
        );
      }

      sendError(res, "STRIPE_TEST_ERROR", "Stripe connection test failed", 500);
    }
  }
);

export default router;
