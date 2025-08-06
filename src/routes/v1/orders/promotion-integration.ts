import { executeQuery } from "../../../utils/database";
import { logger } from "../../../utils/logger";
import PromotionEngine, {
  OrderItem,
  OrderContext,
  PromotionEngineResult,
} from "../../../services/promotion-engine";

/**
 * Enhanced order processing with promotion integration
 * This module provides functions to integrate promotions into the existing order flow
 */

export interface EnhancedOrderData {
  tableId: string;
  items: {
    menuItemId: string;
    quantity: number;
    notes?: string;
  }[];
  orderSource?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  specialInstructions?: string;
  isDelivery?: boolean;
  deliveryAddress?: string;
  deliveryPlatform?: string;
  deliveryOrderId?: string;
  estimatedDeliveryTime?: string;
  priority?: string;
  paymentMethod?: string;
  taxAmount?: number;
  appliedPromoCodes?: string[]; // Promo codes to apply
  autoApplyPromotions?: boolean; // Whether to auto-apply eligible promotions
}

export interface ProcessedOrderResult {
  originalSubtotal: number;
  promotions: PromotionEngineResult;
  finalSubtotal: number;
  taxAmount: number;
  finalAmount: number;
  orderItems: OrderItem[];
  appliedPromotionIds: string[];
}

/**
 * Process order with promotions
 */
export async function processOrderWithPromotions(
  orderData: EnhancedOrderData,
  tenantId: string,
  userId?: string
): Promise<ProcessedOrderResult> {
  try {
    // 1. Validate and fetch menu items with their prices
    const orderItems = await validateAndEnrichOrderItems(
      orderData.items,
      tenantId
    );

    // 2. Calculate original subtotal
    const originalSubtotal = orderItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );

    // 3. Prepare order context for promotion engine
    const orderContext: OrderContext = {
      tenantId,
      orderItems,
      customer: {
        phone: orderData.customerPhone,
        email: orderData.customerEmail,
      },
      orderSource: orderData.orderSource,
      subtotal: originalSubtotal,
      appliedPromoCodes: orderData.appliedPromoCodes || [],
      orderDate: new Date(),
    };

    // 4. Calculate applicable promotions
    let promotionResult: PromotionEngineResult;

    if (orderData.appliedPromoCodes && orderData.appliedPromoCodes.length > 0) {
      // Apply specific promo codes
      promotionResult = await applySpecificPromoCodes(
        orderData.appliedPromoCodes,
        orderContext
      );
    } else if (orderData.autoApplyPromotions !== false) {
      // Auto-apply eligible promotions (default behavior)
      promotionResult = await PromotionEngine.calculatePromotions(orderContext);
    } else {
      // No promotions applied
      promotionResult = {
        applicablePromotions: [],
        totalDiscount: 0,
        finalAmount: originalSubtotal,
        warnings: [],
      };
    }

    // 5. Calculate final amounts
    const finalSubtotal = originalSubtotal - promotionResult.totalDiscount;
    const taxAmount = orderData.taxAmount || finalSubtotal * 0.1; // Default 10% tax
    const finalAmount = finalSubtotal + taxAmount;

    // 6. Update order items with promotional pricing
    const updatedOrderItems = applyPromotionalPricingToItems(
      orderItems,
      promotionResult
    );

    return {
      originalSubtotal,
      promotions: promotionResult,
      finalSubtotal,
      taxAmount,
      finalAmount,
      orderItems: updatedOrderItems,
      appliedPromotionIds: promotionResult.applicablePromotions.map(
        (p) => p.promotionId
      ),
    };
  } catch (error) {
    logger.error("Order processing with promotions failed:", error);
    throw new Error("Failed to process order with promotions");
  }
}

/**
 * Apply specific promo codes to an order
 */
async function applySpecificPromoCodes(
  promoCodes: string[],
  context: OrderContext
): Promise<PromotionEngineResult> {
  const allResults: PromotionEngineResult[] = [];

  for (const promoCode of promoCodes) {
    try {
      const result = await PromotionEngine.applyPromoCode(promoCode, context);
      allResults.push(result);

      // Update context for next promo code
      context.subtotal -= result.totalDiscount;
    } catch (error) {
      logger.warn(`Failed to apply promo code ${promoCode}:`, error);
      allResults.push({
        applicablePromotions: [],
        totalDiscount: 0,
        finalAmount: context.subtotal,
        warnings: [`Invalid promo code: ${promoCode}`],
      });
    }
  }

  // Combine results
  const combinedResult: PromotionEngineResult = allResults.reduce(
    (combined, result) => ({
      applicablePromotions: [
        ...combined.applicablePromotions,
        ...result.applicablePromotions,
      ],
      totalDiscount: combined.totalDiscount + result.totalDiscount,
      finalAmount: result.finalAmount,
      warnings: [...combined.warnings, ...result.warnings],
    }),
    {
      applicablePromotions: [],
      totalDiscount: 0,
      finalAmount: context.subtotal,
      warnings: [],
    }
  );

  return combinedResult;
}

/**
 * Validate order items and enrich with menu item data
 */
async function validateAndEnrichOrderItems(
  items: EnhancedOrderData["items"],
  tenantId: string
): Promise<OrderItem[]> {
  const enrichedItems: OrderItem[] = [];

  for (const item of items) {
    // Fetch menu item details
    const menuItemResult = await executeQuery(
      `SELECT mi.*, c.id as category_id 
       FROM "menuItems" mi 
       LEFT JOIN categories c ON mi."categoryId" = c.id 
       WHERE mi.id = $1 AND mi."tenantId" = $2 AND mi."isActive" = true`,
      [item.menuItemId, tenantId]
    );

    if (menuItemResult.rows.length === 0) {
      throw new Error(`Menu item not found: ${item.menuItemId}`);
    }

    const menuItem = menuItemResult.rows[0];
    const unitPrice = parseFloat(menuItem.price.toString());
    const totalPrice = unitPrice * item.quantity;

    enrichedItems.push({
      menuItemId: item.menuItemId,
      categoryId: menuItem.category_id,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      name: menuItem.name,
    });
  }

  return enrichedItems;
}

/**
 * Apply promotional pricing to order items
 */
function applyPromotionalPricingToItems(
  orderItems: OrderItem[],
  promotionResult: PromotionEngineResult
): OrderItem[] {
  const updatedItems = [...orderItems];

  for (const promotion of promotionResult.applicablePromotions) {
    for (const appliedItem of promotion.appliedItems) {
      const orderItem = updatedItems.find(
        (item) => item.menuItemId === appliedItem.menuItemId
      );
      if (orderItem) {
        // Update unit price to discounted price
        orderItem.unitPrice = appliedItem.discountedPrice;
        orderItem.totalPrice = appliedItem.discountedPrice * orderItem.quantity;
      }
    }
  }

  return updatedItems;
}

/**
 * Save promotion applications to the database
 */
export async function savePromotionApplications(
  orderId: string,
  promotionResult: PromotionEngineResult,
  customerPhone?: string
): Promise<void> {
  try {
    for (const promotion of promotionResult.applicablePromotions) {
      // Save to orderPromotions table
      await executeQuery(
        `INSERT INTO "orderPromotions" (id, "orderId", "promotionId", "discountAmount", "promoCode", "appliedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `order_promo_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`,
          orderId,
          promotion.promotionId,
          promotion.discountAmount,
          promotion.promoCode || null,
          new Date(),
        ]
      );

      // Record promotion usage
      await PromotionEngine.recordPromotionUsage(
        promotion.promotionId,
        orderId,
        promotion.discountAmount,
        promotion.appliedItems.reduce(
          (sum, item) => sum + item.originalPrice * item.quantity,
          0
        ),
        promotion.appliedItems.reduce(
          (sum, item) => sum + item.discountedPrice * item.quantity,
          0
        ),
        promotion.appliedItems,
        customerPhone,
        promotion.promoCode
      );
    }

    logger.info(
      `Saved ${promotionResult.applicablePromotions.length} promotion applications for order ${orderId}`
    );
  } catch (error) {
    logger.error("Failed to save promotion applications:", error);
    throw error;
  }
}

/**
 * Get available promotions for frontend display
 */
export async function getAvailablePromotions(
  tenantId: string,
  includeCodeRequired = false
) {
  try {
    let query = `
      SELECT id, name, description, type, "discountType", "discountValue", "fixedPrice",
             "minCartValue", "maxDiscountAmount", "startDate", "endDate", 
             "timeRangeStart", "timeRangeEnd", "daysOfWeek", "requiresCode", "promoCode"
      FROM promotions 
      WHERE "tenantId" = $1 AND "isActive" = true
        AND (("startDate" IS NULL OR "startDate" <= CURRENT_TIMESTAMP) 
        AND ("endDate" IS NULL OR "endDate" >= CURRENT_TIMESTAMP))
    `;

    if (!includeCodeRequired) {
      query += ` AND ("requiresCode" = false OR "requiresCode" IS NULL)`;
    }

    query += ` ORDER BY priority DESC, "createdAt" DESC`;

    const result = await executeQuery(query, [tenantId]);
    return result.rows;
  } catch (error) {
    logger.error("Failed to get available promotions:", error);
    throw error;
  }
}

/**
 * Preview promotion application without saving
 */
export async function previewPromotions(
  items: EnhancedOrderData["items"],
  tenantId: string,
  promoCodes: string[] = [],
  customerPhone?: string
): Promise<{
  originalSubtotal: number;
  promotions: PromotionEngineResult;
  estimatedFinalAmount: number;
}> {
  try {
    // Validate and enrich items
    const orderItems = await validateAndEnrichOrderItems(items, tenantId);
    const originalSubtotal = orderItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );

    // Prepare context
    const context: OrderContext = {
      tenantId,
      orderItems,
      customer: { phone: customerPhone },
      subtotal: originalSubtotal,
      appliedPromoCodes: promoCodes,
      orderDate: new Date(),
    };

    // Calculate promotions
    let promotionResult: PromotionEngineResult;
    if (promoCodes.length > 0) {
      promotionResult = await applySpecificPromoCodes(promoCodes, context);
    } else {
      promotionResult = await PromotionEngine.calculatePromotions(context);
    }

    const estimatedTax =
      (originalSubtotal - promotionResult.totalDiscount) * 0.1;
    const estimatedFinalAmount =
      originalSubtotal - promotionResult.totalDiscount + estimatedTax;

    return {
      originalSubtotal,
      promotions: promotionResult,
      estimatedFinalAmount,
    };
  } catch (error) {
    logger.error("Promotion preview failed:", error);
    throw error;
  }
}

export default {
  processOrderWithPromotions,
  savePromotionApplications,
  getAvailablePromotions,
  previewPromotions,
};
