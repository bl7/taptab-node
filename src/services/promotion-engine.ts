import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";

export interface OrderItem {
  menuItemId: string;
  categoryId?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  name?: string;
}

export interface Customer {
  phone?: string;
  email?: string;
  id?: string;
  segment?: string;
}

export interface OrderContext {
  tenantId: string;
  orderItems: OrderItem[];
  customer?: Customer;
  orderSource?: string;
  subtotal: number;
  appliedPromoCodes?: string[];
  orderDate?: Date;
}

export interface PromotionResult {
  promotionId: string;
  promotionName: string;
  discountAmount: number;
  appliedItems: {
    menuItemId: string;
    originalPrice: number;
    discountedPrice: number;
    quantity: number;
  }[];
  promoCode?: string;
}

export interface PromotionEngineResult {
  applicablePromotions: PromotionResult[];
  totalDiscount: number;
  finalAmount: number;
  warnings: string[];
}

export class PromotionEngine {
  /**
   * Main function to calculate applicable promotions for an order
   */
  static async calculatePromotions(
    context: OrderContext
  ): Promise<PromotionEngineResult> {
    try {
      logger.info("Calculating promotions for order", {
        tenantId: context.tenantId,
        subtotal: context.subtotal,
        itemCount: context.orderItems.length,
      });

      // Get all active promotions for tenant
      const activePromotions = await this.getActivePromotions(
        context.tenantId,
        context.orderDate
      );

      // Filter promotions based on context
      const eligiblePromotions = await this.filterEligiblePromotions(
        activePromotions,
        context
      );

      // Sort by priority (highest first)
      eligiblePromotions.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      const appliedPromotions: PromotionResult[] = [];
      const warnings: string[] = [];
      let currentSubtotal = context.subtotal;
      let currentItems = [...context.orderItems];

      // Apply promotions in priority order
      for (const promotion of eligiblePromotions) {
        try {
          // Check if promotion can be combined with already applied ones
          if (!promotion.canCombineWithOthers && appliedPromotions.length > 0) {
            // If current promotion has higher priority, replace existing ones
            if (
              appliedPromotions.length > 0 &&
              (promotion.priority || 0) >
                (appliedPromotions[0].promotionId ? 0 : 0)
            ) {
              appliedPromotions.length = 0; // Clear existing promotions
              currentSubtotal = context.subtotal;
              currentItems = [...context.orderItems];
            } else {
              continue; // Skip this promotion
            }
          }

          const result = await this.applyPromotion(promotion, {
            ...context,
            orderItems: currentItems,
            subtotal: currentSubtotal,
          });

          if (result) {
            appliedPromotions.push(result);
            currentSubtotal -= result.discountAmount;

            // Update item prices for subsequent promotions
            this.updateItemPricesAfterPromotion(currentItems, result);
          }
        } catch (error) {
          logger.warn("Failed to apply promotion", {
            promotionId: promotion.id,
            error,
          });
          warnings.push(`Could not apply promotion: ${promotion.name}`);
        }
      }

      const totalDiscount = appliedPromotions.reduce(
        (sum, promo) => sum + promo.discountAmount,
        0
      );
      const finalAmount = Math.max(0, context.subtotal - totalDiscount);

      return {
        applicablePromotions: appliedPromotions,
        totalDiscount,
        finalAmount,
        warnings,
      };
    } catch (error) {
      logger.error("Promotion calculation error:", error);
      throw new Error("Failed to calculate promotions");
    }
  }

  /**
   * Apply a specific promotion code
   */
  static async applyPromoCode(
    promoCode: string,
    context: OrderContext
  ): Promise<PromotionEngineResult> {
    try {
      // Find promotion by code
      const promotionResult = await executeQuery(
        `SELECT * FROM promotions WHERE "promoCode" = $1 AND "tenantId" = $2 AND "isActive" = true`,
        [promoCode, context.tenantId]
      );

      if (promotionResult.rows.length === 0) {
        throw new Error("Invalid or expired promo code");
      }

      const promotion = promotionResult.rows[0];

      // Validate promotion conditions
      const isEligible = await this.validatePromotionEligibility(
        promotion,
        context
      );
      if (!isEligible) {
        throw new Error("Promotion conditions not met");
      }

      // Apply the promotion
      const result = await this.applyPromotion(promotion, context);
      if (!result) {
        throw new Error("Failed to apply promotion");
      }

      return {
        applicablePromotions: [result],
        totalDiscount: result.discountAmount,
        finalAmount: context.subtotal - result.discountAmount,
        warnings: [],
      };
    } catch (error) {
      logger.error("Promo code application error:", error);
      throw error;
    }
  }

  /**
   * Get all active promotions for a tenant
   */
  private static async getActivePromotions(
    tenantId: string,
    orderDate: Date = new Date()
  ): Promise<any[]> {
    const query = `
      SELECT p.*, 
             pi.id as item_id, pi."menuItemId", pi."categoryId", pi."requiredQuantity",
             pi."freeQuantity", pi."discountedPrice", pi."isRequired", pi."maxQuantity"
      FROM promotions p
      LEFT JOIN "promotionItems" pi ON p.id = pi."promotionId"
      WHERE p."tenantId" = $1 
        AND p."isActive" = true
        AND (p."startDate" IS NULL OR p."startDate" <= $2)
        AND (p."endDate" IS NULL OR p."endDate" >= $2)
      ORDER BY p.priority DESC
    `;

    const result = await executeQuery(query, [tenantId, orderDate]);
    return this.groupPromotionsByParent(result.rows);
  }

  /**
   * Group promotion rows by parent promotion
   */
  private static groupPromotionsByParent(rows: any[]) {
    const promotionsMap = new Map();

    for (const row of rows) {
      if (!promotionsMap.has(row.id)) {
        promotionsMap.set(row.id, {
          ...row,
          items: [],
        });
      }

      if (row.item_id) {
        promotionsMap.get(row.id).items.push({
          id: row.item_id,
          menuItemId: row.menuItemId,
          categoryId: row.categoryId,
          requiredQuantity: row.requiredQuantity,
          freeQuantity: row.freeQuantity,
          discountedPrice: row.discountedPrice,
          isRequired: row.isRequired,
          maxQuantity: row.maxQuantity,
        });
      }
    }

    return Array.from(promotionsMap.values());
  }

  /**
   * Filter promotions based on context and conditions
   */
  private static async filterEligiblePromotions(
    promotions: any[],
    context: OrderContext
  ): Promise<any[]> {
    const eligible: any[] = [];

    for (const promotion of promotions) {
      if (await this.validatePromotionEligibility(promotion, context)) {
        eligible.push(promotion);
      }
    }

    return eligible;
  }

  /**
   * Validate if promotion is eligible for the current context
   */
  private static async validatePromotionEligibility(
    promotion: any,
    context: OrderContext
  ): Promise<boolean> {
    try {
      // Check time-based conditions
      if (!this.checkTimeConditions(promotion, context.orderDate)) {
        return false;
      }

      // Check minimum cart value
      if (promotion.minCartValue && context.subtotal < promotion.minCartValue) {
        return false;
      }

      // Check minimum items
      if (
        promotion.minItems &&
        context.orderItems.length < promotion.minItems
      ) {
        return false;
      }

      // Check maximum items
      if (
        promotion.maxItems &&
        context.orderItems.length > promotion.maxItems
      ) {
        return false;
      }

      // Check usage limits
      if (
        promotion.usageLimit &&
        promotion.usageCount >= promotion.usageLimit
      ) {
        return false;
      }

      // Check customer limits
      if (promotion.perCustomerLimit && context.customer?.phone) {
        const customerUsage = await this.getCustomerUsageCount(
          promotion.id,
          context.customer.phone,
          context.tenantId
        );
        if (customerUsage >= promotion.perCustomerLimit) {
          return false;
        }
      }

      // Check if required items are in cart
      if (
        promotion.items &&
        promotion.items.some((item: any) => item.isRequired)
      ) {
        const hasRequiredItems = this.checkRequiredItems(
          promotion.items,
          context.orderItems
        );
        if (!hasRequiredItems) {
          return false;
        }
      }

      // Check if promotion code is required and provided
      if (
        promotion.requiresCode &&
        !context.appliedPromoCodes?.includes(promotion.promoCode)
      ) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error("Promotion eligibility validation error:", error);
      return false;
    }
  }

  /**
   * Check time-based conditions
   */
  private static checkTimeConditions(
    promotion: any,
    orderDate: Date = new Date()
  ): boolean {
    // Check day of week
    if (promotion.daysOfWeek && promotion.daysOfWeek.length > 0) {
      const dayOfWeek = orderDate.getDay() === 0 ? 7 : orderDate.getDay(); // Convert Sunday from 0 to 7
      if (!promotion.daysOfWeek.includes(dayOfWeek)) {
        return false;
      }
    }

    // Check time range
    if (promotion.timeRangeStart && promotion.timeRangeEnd) {
      const currentTime = orderDate.getHours() * 60 + orderDate.getMinutes();
      const startTime = this.timeStringToMinutes(promotion.timeRangeStart);
      const endTime = this.timeStringToMinutes(promotion.timeRangeEnd);

      if (currentTime < startTime || currentTime > endTime) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert time string (HH:MM) to minutes since midnight
   */
  private static timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Check if required items are in the order
   */
  private static checkRequiredItems(
    promotionItems: any[],
    orderItems: OrderItem[]
  ): boolean {
    const requiredItems = promotionItems.filter((item) => item.isRequired);

    for (const requiredItem of requiredItems) {
      const found = orderItems.some((orderItem) => {
        if (
          requiredItem.menuItemId &&
          orderItem.menuItemId === requiredItem.menuItemId
        ) {
          return orderItem.quantity >= requiredItem.requiredQuantity;
        }
        if (
          requiredItem.categoryId &&
          orderItem.categoryId === requiredItem.categoryId
        ) {
          return orderItem.quantity >= requiredItem.requiredQuantity;
        }
        return false;
      });

      if (!found) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get customer usage count for a promotion
   */
  private static async getCustomerUsageCount(
    promotionId: string,
    customerPhone: string,
    tenantId: string
  ): Promise<number> {
    const result = await executeQuery(
      'SELECT COALESCE("usageCount", 0) as count FROM "customerPromotionUsage" WHERE "promotionId" = $1 AND "customerPhone" = $2 AND "tenantId" = $3',
      [promotionId, customerPhone, tenantId]
    );

    return result.rows.length > 0 ? parseInt(result.rows[0].count) : 0;
  }

  /**
   * Apply a specific promotion to the order
   */
  private static async applyPromotion(
    promotion: any,
    context: OrderContext
  ): Promise<PromotionResult | null> {
    try {
      switch (promotion.type) {
        case "CART_DISCOUNT":
          return this.applyCartDiscount(promotion, context);
        case "ITEM_DISCOUNT":
          return this.applyItemDiscount(promotion, context);
        case "BOGO":
          return this.applyBogoPromotion(promotion, context);
        case "COMBO_DEAL":
          return this.applyComboPromotion(promotion, context);
        case "FIXED_PRICE":
          return this.applyFixedPricePromotion(promotion, context);
        case "TIME_BASED":
          return this.applyTimeBased(promotion, context);
        case "COUPON":
          return this.applyCouponPromotion(promotion, context);
        default:
          logger.warn("Unknown promotion type:", promotion.type);
          return null;
      }
    } catch (error) {
      logger.error("Promotion application error:", error);
      return null;
    }
  }

  /**
   * Apply cart-level discount
   */
  private static applyCartDiscount(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    let discountAmount = 0;

    if (promotion.discountType === "PERCENTAGE") {
      discountAmount = (context.subtotal * promotion.discountValue) / 100;
      if (promotion.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, promotion.maxDiscountAmount);
      }
    } else if (promotion.discountType === "FIXED_AMOUNT") {
      discountAmount = Math.min(promotion.discountValue, context.subtotal);
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      discountAmount,
      appliedItems: context.orderItems.map((item) => ({
        menuItemId: item.menuItemId,
        originalPrice: item.unitPrice,
        discountedPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      promoCode: promotion.promoCode,
    };
  }

  /**
   * Apply item-specific discount
   */
  private static applyItemDiscount(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    const appliedItems: any[] = [];
    let totalDiscount = 0;

    for (const orderItem of context.orderItems) {
      const promotionItem = promotion.items.find(
        (pi: any) =>
          pi.menuItemId === orderItem.menuItemId ||
          pi.categoryId === orderItem.categoryId
      );

      if (promotionItem) {
        const maxQuantity = promotionItem.maxQuantity || orderItem.quantity;
        const discountQuantity = Math.min(orderItem.quantity, maxQuantity);

        let itemDiscount = 0;
        let discountedPrice = orderItem.unitPrice;

        if (promotion.discountType === "PERCENTAGE") {
          itemDiscount =
            (orderItem.unitPrice * promotion.discountValue * discountQuantity) /
            100;
          discountedPrice =
            orderItem.unitPrice * (1 - promotion.discountValue / 100);
        } else if (promotion.discountType === "FIXED_AMOUNT") {
          itemDiscount = Math.min(
            promotion.discountValue * discountQuantity,
            orderItem.totalPrice
          );
          discountedPrice = Math.max(
            0,
            orderItem.unitPrice - promotion.discountValue
          );
        } else if (
          promotion.discountType === "FIXED_PRICE" &&
          promotionItem.discountedPrice
        ) {
          discountedPrice = promotionItem.discountedPrice;
          itemDiscount =
            (orderItem.unitPrice - discountedPrice) * discountQuantity;
        }

        if (itemDiscount > 0) {
          totalDiscount += itemDiscount;
          appliedItems.push({
            menuItemId: orderItem.menuItemId,
            originalPrice: orderItem.unitPrice,
            discountedPrice,
            quantity: discountQuantity,
          });
        }
      }
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      discountAmount: totalDiscount,
      appliedItems,
      promoCode: promotion.promoCode,
    };
  }

  /**
   * Apply BOGO (Buy One Get One) promotion
   */
  private static applyBogoPromotion(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    const appliedItems: any[] = [];
    let totalDiscount = 0;

    for (const promotionItem of promotion.items) {
      const orderItems = context.orderItems.filter(
        (item) =>
          item.menuItemId === promotionItem.menuItemId ||
          item.categoryId === promotionItem.categoryId
      );

      for (const orderItem of orderItems) {
        const requiredQty = promotionItem.requiredQuantity || 1;
        const freeQty = promotionItem.freeQuantity || 1;
        const sets = Math.floor(orderItem.quantity / (requiredQty + freeQty));

        if (sets > 0) {
          const freeItems = sets * freeQty;
          const discount = freeItems * orderItem.unitPrice;

          totalDiscount += discount;
          appliedItems.push({
            menuItemId: orderItem.menuItemId,
            originalPrice: orderItem.unitPrice,
            discountedPrice: orderItem.unitPrice,
            quantity: freeItems,
          });
        }
      }
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      discountAmount: totalDiscount,
      appliedItems,
      promoCode: promotion.promoCode,
    };
  }

  /**
   * Apply combo deal promotion
   */
  private static applyComboPromotion(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    // Simplified combo logic - can be expanded based on specific requirements
    const requiredItems = promotion.items.filter(
      (item: any) => item.isRequired
    );
    const hasAllRequired = requiredItems.every((reqItem: any) =>
      context.orderItems.some(
        (orderItem) =>
          (orderItem.menuItemId === reqItem.menuItemId ||
            orderItem.categoryId === reqItem.categoryId) &&
          orderItem.quantity >= reqItem.requiredQuantity
      )
    );

    if (!hasAllRequired) {
      return {
        promotionId: promotion.id,
        promotionName: promotion.name,
        discountAmount: 0,
        appliedItems: [],
        promoCode: promotion.promoCode,
      };
    }

    // Apply combo discount
    return this.applyCartDiscount(promotion, context);
  }

  /**
   * Apply fixed price promotion
   */
  private static applyFixedPricePromotion(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    if (!promotion.fixedPrice) {
      return {
        promotionId: promotion.id,
        promotionName: promotion.name,
        discountAmount: 0,
        appliedItems: [],
        promoCode: promotion.promoCode,
      };
    }

    const discountAmount = Math.max(0, context.subtotal - promotion.fixedPrice);

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      discountAmount,
      appliedItems: context.orderItems.map((item) => ({
        menuItemId: item.menuItemId,
        originalPrice: item.unitPrice,
        discountedPrice: item.unitPrice,
        quantity: item.quantity,
      })),
      promoCode: promotion.promoCode,
    };
  }

  /**
   * Apply time-based promotion (delegates to other promotion types)
   */
  private static applyTimeBased(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    // Time-based promotions are usually item discounts or cart discounts with time restrictions
    if (
      promotion.discountType === "PERCENTAGE" ||
      promotion.discountType === "FIXED_AMOUNT"
    ) {
      if (promotion.items && promotion.items.length > 0) {
        return this.applyItemDiscount(promotion, context);
      } else {
        return this.applyCartDiscount(promotion, context);
      }
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      discountAmount: 0,
      appliedItems: [],
      promoCode: promotion.promoCode,
    };
  }

  /**
   * Apply coupon promotion
   */
  private static applyCouponPromotion(
    promotion: any,
    context: OrderContext
  ): PromotionResult {
    // Coupon promotions work like regular discounts but require a code
    if (promotion.items && promotion.items.length > 0) {
      return this.applyItemDiscount(promotion, context);
    } else {
      return this.applyCartDiscount(promotion, context);
    }
  }

  /**
   * Update item prices after a promotion is applied
   */
  private static updateItemPricesAfterPromotion(
    items: OrderItem[],
    result: PromotionResult
  ) {
    for (const appliedItem of result.appliedItems) {
      const orderItem = items.find(
        (item) => item.menuItemId === appliedItem.menuItemId
      );
      if (orderItem) {
        orderItem.unitPrice = appliedItem.discountedPrice;
        orderItem.totalPrice = orderItem.unitPrice * orderItem.quantity;
      }
    }
  }

  /**
   * Record promotion usage
   */
  static async recordPromotionUsage(
    promotionId: string,
    orderId: string,
    discountAmount: number,
    originalAmount: number,
    finalAmount: number,
    affectedItems: any[],
    customerPhone?: string,
    promoCode?: string
  ) {
    try {
      // Record in promotion usage table
      const usageData = {
        id: `usage_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        promotionId,
        orderId,
        customerId: null, // Can be enhanced if customer management is implemented
        customerPhone: customerPhone || null,
        discountAmount,
        originalAmount,
        finalAmount,
        appliedAt: new Date(),
        promoCode: promoCode || null,
        affectedItems: JSON.stringify(affectedItems),
      };

      await executeQuery(
        `INSERT INTO "promotionUsage" (id, "promotionId", "orderId", "customerId", "customerPhone", 
         "discountAmount", "originalAmount", "finalAmount", "appliedAt", "promoCode", "affectedItems") 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          usageData.id,
          usageData.promotionId,
          usageData.orderId,
          usageData.customerId,
          usageData.customerPhone,
          usageData.discountAmount,
          usageData.originalAmount,
          usageData.finalAmount,
          usageData.appliedAt,
          usageData.promoCode,
          usageData.affectedItems,
        ]
      );

      // Update promotion usage count
      await executeQuery(
        'UPDATE promotions SET "usageCount" = "usageCount" + 1 WHERE id = $1',
        [promotionId]
      );

      // Update customer usage count if customer phone is provided
      if (customerPhone) {
        await executeQuery(
          `INSERT INTO "customerPromotionUsage" ("customerId", "customerPhone", "promotionId", "tenantId", "usageCount", "lastUsed")
           VALUES (NULL, $1, $2, (SELECT "tenantId" FROM promotions WHERE id = $2), 1, $3)
           ON CONFLICT ("customerPhone", "promotionId", "tenantId") 
           DO UPDATE SET "usageCount" = "customerPromotionUsage"."usageCount" + 1, "lastUsed" = $3`,
          [customerPhone, promotionId, new Date()]
        );
      }

      logger.info("Promotion usage recorded", {
        promotionId,
        orderId,
        discountAmount,
      });
    } catch (error) {
      logger.error("Failed to record promotion usage:", error);
    }
  }
}

export default PromotionEngine;
