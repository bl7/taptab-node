import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";

export interface Promotion {
  id: string;
  name: string;
  description: string;
  type: "HAPPY_HOUR" | "BOGO" | "PERCENTAGE_OFF" | "FIXED_OFF";
  discount_value: number;
  min_order_amount: number;
  max_discount_amount?: number;

  // BOGO specific fields
  buy_quantity?: number;
  get_quantity?: number;
  buy_target_type?: "ALL" | "CATEGORY" | "PRODUCTS";
  buy_target_category_id?: string;
  buy_target_product_ids?: string[];
  get_target_type?: "ALL" | "CATEGORY" | "PRODUCTS";
  get_target_category_id?: string;
  get_target_product_ids?: string[];

  // Happy Hour specific
  start_time?: string;
  end_time?: string;
  days_of_week?: number[];

  // Product/Category targeting (for non-BOGO promotions)
  target_type: "ALL" | "CATEGORY" | "PRODUCTS";
  target_category_id?: string;
  target_product_ids?: string[];
  priority: number;
  startDate?: string;
  endDate?: string;
}

export interface OrderItem {
  menuItemId: string;
  categoryId: string;
  quantity: number;
  unitPrice: number;
  name: string;
}

export interface PromotionResult {
  promotionId: string;
  promotionName: string;
  discountAmount: number;
  type: string;
  appliedItems: string[];
}

export class SimplePromotions {
  /**
   * Get all active promotions for a tenant
   */
  static async getActivePromotions(tenantId: string): Promise<Promotion[]> {
    try {
      const query = `
        SELECT * FROM promotions 
        WHERE "tenantId" = $1 
        AND "isActive" = true
        AND ("startDate" IS NULL OR "startDate" <= CURRENT_DATE)
        AND ("endDate" IS NULL OR "endDate" >= CURRENT_DATE)
        ORDER BY priority DESC, "createdAt" DESC
      `;

      const result = await executeQuery(query, [tenantId]);
      return result.rows;
    } catch (error) {
      logger.error("Error fetching promotions:", error);
      return [];
    }
  }

  /**
   * Calculate applicable promotions for an order
   */
  static async calculatePromotions(
    orderItems: OrderItem[],
    tenantId: string,
    orderTime: Date = new Date()
  ): Promise<PromotionResult[]> {
    try {
      const activePromotions = await this.getActivePromotions(tenantId);
      const applicablePromotions: PromotionResult[] = [];

      for (const promotion of activePromotions) {
        const result = await this.applyPromotion(
          promotion,
          orderItems,
          orderTime
        );
        if (result) {
          applicablePromotions.push(result);
        }
      }

      return applicablePromotions;
    } catch (error) {
      logger.error("Error calculating promotions:", error);
      return [];
    }
  }

  /**
   * Apply a specific promotion to order items
   */
  private static async applyPromotion(
    promotion: Promotion,
    orderItems: OrderItem[],
    orderTime: Date
  ): Promise<PromotionResult | null> {
    try {
      // Check if promotion is valid for current time
      if (!this.isPromotionValidNow(promotion, orderTime)) {
        return null;
      }

      // Check if promotion applies to any items
      const applicableItems = this.getApplicableItems(promotion, orderItems);
      if (applicableItems.length === 0) {
        return null;
      }

      let discountAmount = 0;
      let appliedItems: string[] = [];

      switch (promotion.type) {
        case "HAPPY_HOUR":
          const happyHourResult = this.applyHappyHour(
            promotion,
            applicableItems
          );
          discountAmount = happyHourResult.discountAmount;
          appliedItems = happyHourResult.appliedItems;
          break;

        case "BOGO":
          const bogoResult = this.applyBOGO(promotion, applicableItems);
          discountAmount = bogoResult.discountAmount;
          appliedItems = bogoResult.appliedItems;
          break;

        case "PERCENTAGE_OFF":
          const percentageResult = this.applyPercentageOff(
            promotion,
            applicableItems
          );
          discountAmount = percentageResult.discountAmount;
          appliedItems = percentageResult.appliedItems;
          break;

        case "FIXED_OFF":
          const fixedResult = this.applyFixedOff(promotion, applicableItems);
          discountAmount = fixedResult.discountAmount;
          appliedItems = fixedResult.appliedItems;
          break;
      }

      if (discountAmount > 0) {
        return {
          promotionId: promotion.id,
          promotionName: promotion.name,
          discountAmount,
          type: promotion.type,
          appliedItems,
        };
      }

      return null;
    } catch (error) {
      logger.error("Error applying promotion:", error);
      return null;
    }
  }

  /**
   * Check if promotion is valid for current time
   */
  private static isPromotionValidNow(
    promotion: Promotion,
    orderTime: Date
  ): boolean {
    // Check date range
    if (promotion.startDate && new Date(promotion.startDate) > orderTime)
      return false;
    if (promotion.endDate && new Date(promotion.endDate) < orderTime)
      return false;

    // Check happy hour time
    if (
      promotion.type === "HAPPY_HOUR" &&
      promotion.start_time &&
      promotion.end_time
    ) {
      const currentTime = orderTime.toTimeString().slice(0, 5); // HH:MM format
      const startTime = promotion.start_time;
      const endTime = promotion.end_time;

      // Handle overnight happy hours (e.g., 22:00 to 02:00)
      if (startTime > endTime) {
        // Overnight: current time should be >= start OR <= end
        if (currentTime < startTime && currentTime > endTime) return false;
      } else {
        // Normal: current time should be between start and end
        if (currentTime < startTime || currentTime > endTime) return false;
      }
    }

    // Check days of week
    if (promotion.days_of_week && promotion.days_of_week.length > 0) {
      const currentDay = orderTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const adjustedDay = currentDay === 0 ? 7 : currentDay; // Convert to 1-7 format
      if (!promotion.days_of_week.includes(adjustedDay)) return false;
    }

    return true;
  }

  /**
   * Get items that are applicable for this promotion
   */
  private static getApplicableItems(
    promotion: Promotion,
    orderItems: OrderItem[]
  ): OrderItem[] {
    switch (promotion.type) {
      case "BOGO":
        return this.getBOGOApplicableItems(promotion, orderItems);
      default:
        return this.getNonBOGOApplicableItems(promotion, orderItems);
    }
  }

  private static getNonBOGOApplicableItems(
    promotion: Promotion,
    orderItems: OrderItem[]
  ): OrderItem[] {
    switch (promotion.target_type) {
      case "ALL":
        return orderItems;

      case "CATEGORY":
        if (!promotion.target_category_id) return [];
        return orderItems.filter(
          (item) => item.categoryId === promotion.target_category_id
        );

      case "PRODUCTS":
        if (!promotion.target_product_ids) return [];
        return orderItems.filter((item) =>
          promotion.target_product_ids!.includes(item.menuItemId)
        );

      default:
        return [];
    }
  }

  private static getBOGOApplicableItems(
    promotion: Promotion,
    orderItems: OrderItem[]
  ): OrderItem[] {
    const buyItems: OrderItem[] = [];
    const getItems: OrderItem[] = [];

    // Determine buy items
    if (promotion.buy_target_type === "ALL") {
      buyItems.push(...orderItems);
    } else if (promotion.buy_target_type === "CATEGORY") {
      if (promotion.buy_target_category_id) {
        buyItems.push(
          ...orderItems.filter(
            (item) => item.categoryId === promotion.buy_target_category_id
          )
        );
      }
    } else if (promotion.buy_target_type === "PRODUCTS") {
      if (promotion.buy_target_product_ids) {
        buyItems.push(
          ...orderItems.filter((item) =>
            promotion.buy_target_product_ids!.includes(item.menuItemId)
          )
        );
      }
    }

    // Determine get items
    if (promotion.get_target_type === "ALL") {
      getItems.push(...orderItems);
    } else if (promotion.get_target_type === "CATEGORY") {
      if (promotion.get_target_category_id) {
        getItems.push(
          ...orderItems.filter(
            (item) => item.categoryId === promotion.get_target_category_id
          )
        );
      }
    } else if (promotion.get_target_type === "PRODUCTS") {
      if (promotion.get_target_product_ids) {
        getItems.push(
          ...orderItems.filter((item) =>
            promotion.get_target_product_ids!.includes(item.menuItemId)
          )
        );
      }
    }

    // Apply BOGO logic
    const buyQty = promotion.buy_quantity || 1;
    const getQty = promotion.get_quantity || 1;
    const freeItems: string[] = [];

    for (const item of buyItems) {
      const freeItemsCount =
        Math.floor(item.quantity / (buyQty + getQty)) * getQty;
      for (let i = 0; i < freeItemsCount; i++) {
        freeItems.push(item.menuItemId);
      }
    }

    return getItems.filter((item) => freeItems.includes(item.menuItemId));
  }

  /**
   * Apply Happy Hour promotion
   */
  private static applyHappyHour(
    promotion: Promotion,
    items: OrderItem[]
  ): { discountAmount: number; appliedItems: string[] } {
    const discountPercent = promotion.discount_value / 100;
    let totalDiscount = 0;
    const appliedItems: string[] = [];

    for (const item of items) {
      const itemDiscount = item.unitPrice * item.quantity * discountPercent;
      const maxDiscount = promotion.max_discount_amount || Infinity;
      const finalDiscount = Math.min(itemDiscount, maxDiscount);

      totalDiscount += finalDiscount;
      appliedItems.push(item.menuItemId);
    }

    return { discountAmount: totalDiscount, appliedItems };
  }

  /**
   * Apply BOGO promotion
   */
  private static applyBOGO(
    promotion: Promotion,
    items: OrderItem[]
  ): { discountAmount: number; appliedItems: string[] } {
    const buyQty = promotion.buy_quantity || 1;
    const getQty = promotion.get_quantity || 1;
    let totalDiscount = 0;
    const appliedItems: string[] = [];

    // Get buy items (what customer must purchase)
    const buyItems = this.getBOGOBuyItems(promotion, items);

    // Get get items (what customer gets for free)
    const getItems = this.getBOGOGetItems(promotion, items);

    // Calculate how many free items they can get
    const totalBuyQuantity = buyItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const freeItemsCount = Math.floor(totalBuyQuantity / buyQty) * getQty;

    // Apply discount to get items (up to the free count)
    let remainingFreeItems = freeItemsCount;

    for (const item of getItems) {
      if (remainingFreeItems <= 0) break;

      const itemsToDiscount = Math.min(remainingFreeItems, item.quantity);
      const itemDiscount = itemsToDiscount * item.unitPrice;

      totalDiscount += itemDiscount;
      remainingFreeItems -= itemsToDiscount;

      if (itemsToDiscount > 0) {
        appliedItems.push(item.menuItemId);
      }
    }

    return { discountAmount: totalDiscount, appliedItems };
  }

  /**
   * Get items that qualify for "buy" part of BOGO
   */
  private static getBOGOBuyItems(
    promotion: Promotion,
    orderItems: OrderItem[]
  ): OrderItem[] {
    if (promotion.buy_target_type === "ALL") {
      return orderItems;
    } else if (promotion.buy_target_type === "CATEGORY") {
      if (promotion.buy_target_category_id) {
        return orderItems.filter(
          (item) => item.categoryId === promotion.buy_target_category_id
        );
      }
    } else if (promotion.buy_target_type === "PRODUCTS") {
      if (promotion.buy_target_product_ids) {
        return orderItems.filter((item) =>
          promotion.buy_target_product_ids!.includes(item.menuItemId)
        );
      }
    }
    return [];
  }

  /**
   * Get items that qualify for "get" part of BOGO
   */
  private static getBOGOGetItems(
    promotion: Promotion,
    orderItems: OrderItem[]
  ): OrderItem[] {
    if (promotion.get_target_type === "ALL") {
      return orderItems;
    } else if (promotion.get_target_type === "CATEGORY") {
      if (promotion.get_target_category_id) {
        return orderItems.filter(
          (item) => item.categoryId === promotion.get_target_category_id
        );
      }
    } else if (promotion.get_target_type === "PRODUCTS") {
      if (promotion.get_target_product_ids) {
        return orderItems.filter((item) =>
          promotion.get_target_product_ids!.includes(item.menuItemId)
        );
      }
    }
    return [];
  }

  /**
   * Apply Percentage Off promotion
   */
  private static applyPercentageOff(
    promotion: Promotion,
    items: OrderItem[]
  ): { discountAmount: number; appliedItems: string[] } {
    const discountPercent = promotion.discount_value / 100;
    let totalDiscount = 0;
    const appliedItems: string[] = [];

    for (const item of items) {
      const itemDiscount = item.unitPrice * item.quantity * discountPercent;
      const maxDiscount = promotion.max_discount_amount || Infinity;
      const finalDiscount = Math.min(itemDiscount, maxDiscount);

      totalDiscount += finalDiscount;
      appliedItems.push(item.menuItemId);
    }

    return { discountAmount: totalDiscount, appliedItems };
  }

  /**
   * Apply Fixed Amount Off promotion
   */
  private static applyFixedOff(
    promotion: Promotion,
    items: OrderItem[]
  ): { discountAmount: number; appliedItems: string[] } {
    let totalDiscount = 0;
    const appliedItems: string[] = [];

    for (const item of items) {
      const itemDiscount = Math.min(
        promotion.discount_value,
        item.unitPrice * item.quantity
      );
      totalDiscount += itemDiscount;
      appliedItems.push(item.menuItemId);
    }

    return { discountAmount: totalDiscount, appliedItems };
  }
}
