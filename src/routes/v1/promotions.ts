import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import {
  executeQuery,
  createWithCheck,
  updateWithCheck,
  deleteWithCheck,
  findMany,
} from "../../utils/database";

const router = Router();

// ==================== PROMOTION MANAGEMENT ====================

// GET /api/v1/promotions - Get all promotions
router.get(
  "/",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { active, type, search } = req.query;

      let query = `
      SELECT p.*, 
             COUNT(pu.id) as usage_count,
             COUNT(CASE WHEN pu."appliedAt" >= CURRENT_DATE THEN 1 END) as today_usage
      FROM promotions p
      LEFT JOIN "promotionUsage" pu ON p.id = pu."promotionId"
      WHERE p."tenantId" = $1
    `;
      const values: any[] = [tenantId];

      if (active !== undefined) {
        query += ` AND p."isActive" = $${values.length + 1}`;
        values.push(active === "true");
      }

      if (type) {
        query += ` AND p.type = $${values.length + 1}`;
        values.push(type);
      }

      if (search) {
        query += ` AND (p.name ILIKE $${
          values.length + 1
        } OR p.description ILIKE $${values.length + 1})`;
        values.push(`%${search}%`);
      }

      query += ` GROUP BY p.id ORDER BY p.priority DESC, p."createdAt" DESC`;

      const result = await executeQuery(query, values);
      const promotions = result.rows.map((promo: any) => ({
        ...promo,
        usage_count: parseInt(promo.usage_count),
        today_usage: parseInt(promo.today_usage),
      }));

      sendSuccess(res, { promotions });
    } catch (error) {
      logger.error("Get promotions error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch promotions");
    }
  }
);

// POST /api/v1/promotions - Create new promotion
router.post(
  "/",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const user = (req as any).user;

      const {
        name,
        description,
        type,
        discountType,
        discountValue,
        fixedPrice,
        minCartValue = 0,
        maxDiscountAmount,
        minItems = 1,
        maxItems,
        usageLimit,
        perCustomerLimit,
        startDate,
        endDate,
        timeRangeStart,
        timeRangeEnd,
        daysOfWeek,
        requiresCode = false,
        promoCode,
        autoApply = true,
        customerSegments = [],
        customerTypes = [],
        priority = 0,
        canCombineWithOthers = false,
        items = [], // promotion items
      } = req.body;

      // Validation
      if (!name || !type || !discountType) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Name, type, and discountType are required",
          400
        );
      }

      const validTypes = [
        "ITEM_DISCOUNT",
        "COMBO_DEAL",
        "CART_DISCOUNT",
        "BOGO",
        "FIXED_PRICE",
        "TIME_BASED",
        "COUPON",
      ];
      if (!validTypes.includes(type)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid promotion type. Must be one of: ${validTypes.join(", ")}`,
          400
        );
      }

      const validDiscountTypes = [
        "PERCENTAGE",
        "FIXED_AMOUNT",
        "FREE_ITEM",
        "FIXED_PRICE",
      ];
      if (!validDiscountTypes.includes(discountType)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid discount type. Must be one of: ${validDiscountTypes.join(
            ", "
          )}`,
          400
        );
      }

      // Validate promo code uniqueness if provided
      if (promoCode) {
        const existingPromo = await executeQuery(
          'SELECT id FROM promotions WHERE "promoCode" = $1 AND "tenantId" = $2',
          [promoCode, tenantId]
        );
        if (existingPromo.rows.length > 0) {
          return sendError(
            res,
            "DUPLICATE_ERROR",
            "Promo code already exists",
            400
          );
        }
      }

      const promotionData = {
        id: `promo_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        tenantId,
        name,
        description,
        type,
        discountType,
        discountValue:
          discountType === "PERCENTAGE" || discountType === "FIXED_AMOUNT"
            ? discountValue
            : null,
        fixedPrice: discountType === "FIXED_PRICE" ? fixedPrice : null,
        minCartValue,
        maxDiscountAmount,
        minItems,
        maxItems,
        usageLimit,
        usageCount: 0,
        perCustomerLimit,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        timeRangeStart,
        timeRangeEnd,
        daysOfWeek: daysOfWeek || null,
        requiresCode,
        promoCode,
        autoApply,
        customerSegments,
        customerTypes,
        priority,
        canCombineWithOthers,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: user?.id || null,
      };

      // Create promotion
      const promotion = await createWithCheck(
        "promotions",
        promotionData,
        "name",
        name,
        tenantId
      );

      // Create promotion items if provided
      if (items && items.length > 0) {
        for (const item of items) {
          const itemData = {
            id: `promo_item_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 5)}`,
            promotionId: promotion.id,
            menuItemId: item.menuItemId || null,
            categoryId: item.categoryId || null,
            requiredQuantity: item.requiredQuantity || 1,
            freeQuantity: item.freeQuantity || 0,
            discountedPrice: item.discountedPrice || null,
            isRequired: item.isRequired || false,
            maxQuantity: item.maxQuantity || null,
            createdAt: new Date(),
          };

          await executeQuery(
            `INSERT INTO "promotionItems" (id, "promotionId", "menuItemId", "categoryId", "requiredQuantity", 
           "freeQuantity", "discountedPrice", "isRequired", "maxQuantity", "createdAt") 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              itemData.id,
              itemData.promotionId,
              itemData.menuItemId,
              itemData.categoryId,
              itemData.requiredQuantity,
              itemData.freeQuantity,
              itemData.discountedPrice,
              itemData.isRequired,
              itemData.maxQuantity,
              itemData.createdAt,
            ]
          );
        }
      }

      // Get complete promotion with items
      const completePromotion = await getPromotionWithItems(promotion.id);

      logger.info(
        `Promotion created: ${name} by ${user?.firstName} ${user?.lastName}`
      );
      sendSuccess(
        res,
        { promotion: completePromotion },
        "Promotion created successfully",
        201
      );
    } catch (error) {
      logger.error("Create promotion error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create promotion");
    }
  }
);

// PUT /api/v1/promotions/:id - Update promotion
router.put(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const updateData = { ...req.body, updatedAt: new Date() };

      // Validate promo code uniqueness if changed
      if (updateData.promoCode) {
        const existingPromo = await executeQuery(
          'SELECT id FROM promotions WHERE "promoCode" = $1 AND "tenantId" = $2 AND id != $3',
          [updateData.promoCode, tenantId, id]
        );
        if (existingPromo.rows.length > 0) {
          return sendError(
            res,
            "DUPLICATE_ERROR",
            "Promo code already exists",
            400
          );
        }
      }

      const promotion = await updateWithCheck(
        "promotions",
        id,
        updateData,
        tenantId
      );

      // Update promotion items if provided
      if (updateData.items) {
        // Delete existing items
        await executeQuery(
          'DELETE FROM "promotionItems" WHERE "promotionId" = $1',
          [id]
        );

        // Create new items
        for (const item of updateData.items) {
          const itemData = {
            id: `promo_item_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 5)}`,
            promotionId: id,
            menuItemId: item.menuItemId || null,
            categoryId: item.categoryId || null,
            requiredQuantity: item.requiredQuantity || 1,
            freeQuantity: item.freeQuantity || 0,
            discountedPrice: item.discountedPrice || null,
            isRequired: item.isRequired || false,
            maxQuantity: item.maxQuantity || null,
            createdAt: new Date(),
          };

          await executeQuery(
            `INSERT INTO "promotionItems" (id, "promotionId", "menuItemId", "categoryId", "requiredQuantity", 
           "freeQuantity", "discountedPrice", "isRequired", "maxQuantity", "createdAt") 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              itemData.id,
              itemData.promotionId,
              itemData.menuItemId,
              itemData.categoryId,
              itemData.requiredQuantity,
              itemData.freeQuantity,
              itemData.discountedPrice,
              itemData.isRequired,
              itemData.maxQuantity,
              itemData.createdAt,
            ]
          );
        }
      }

      const completePromotion = await getPromotionWithItems(id);
      sendSuccess(
        res,
        { promotion: completePromotion },
        "Promotion updated successfully"
      );
    } catch (error) {
      logger.error("Update promotion error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update promotion");
    }
  }
);

// DELETE /api/v1/promotions/:id - Delete promotion
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      await deleteWithCheck("promotions", id, tenantId);

      sendSuccess(res, null, "Promotion deleted successfully");
    } catch (error) {
      logger.error("Delete promotion error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete promotion");
    }
  }
);

// POST /api/v1/promotions/validate - Validate promotion code
router.post("/validate", async (req: Request, res: Response) => {
  try {
    const {
      promoCode,
      tenantSlug,
      customerPhone,
      orderItems = [],
      cartTotal = 0,
    } = req.body;

    if (!promoCode || !tenantSlug) {
      return sendError(
        res,
        "VALIDATION_ERROR",
        "Promo code and tenant slug are required",
        400
      );
    }

    // Get tenant
    const tenantResult = await executeQuery(
      'SELECT id FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );
    if (tenantResult.rows.length === 0) {
      return sendError(res, "TENANT_NOT_FOUND", "Restaurant not found", 404);
    }
    const tenantId = tenantResult.rows[0].id;

    // Find promotion
    const promoResult = await executeQuery(
      `SELECT * FROM promotions WHERE "promoCode" = $1 AND "tenantId" = $2 AND "isActive" = true`,
      [promoCode, tenantId]
    );

    if (promoResult.rows.length === 0) {
      return sendError(
        res,
        "INVALID_CODE",
        "Invalid or expired promo code",
        400
      );
    }

    const promotion = promoResult.rows[0];

    // Validate promotion conditions
    const validation = await validatePromotionConditions(promotion, {
      customerPhone,
      orderItems,
      cartTotal,
      tenantId,
    });

    if (!validation.isValid) {
      return sendError(
        res,
        "PROMOTION_INVALID",
        validation.reason || "Promotion conditions not met",
        400
      );
    }

    sendSuccess(res, {
      promotion: {
        id: promotion.id,
        name: promotion.name,
        description: promotion.description,
        discountType: promotion.discountType,
        discountValue: promotion.discountValue,
        fixedPrice: promotion.fixedPrice,
      },
      estimatedDiscount: validation.estimatedDiscount,
    });
  } catch (error) {
    logger.error("Validate promotion error:", error);
    sendError(res, "VALIDATION_ERROR", "Failed to validate promotion");
  }
});

// GET /api/v1/promotions/analytics - Get promotion analytics
router.get(
  "/analytics",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { startDate, endDate } = req.query;

      const start = startDate
        ? new Date(startDate as string)
        : new Date(new Date().setDate(new Date().getDate() - 30));
      const end = endDate ? new Date(endDate as string) : new Date();

      // Get promotion usage analytics
      const usageQuery = `
      SELECT 
        p.id, p.name, p.type, p."discountType",
        COUNT(pu.id) as total_uses,
        SUM(pu."discountAmount") as total_discount_given,
        SUM(pu."originalAmount") as total_original_amount,
        AVG(pu."discountAmount") as avg_discount_per_use
      FROM promotions p
      LEFT JOIN "promotionUsage" pu ON p.id = pu."promotionId" 
        AND pu."appliedAt" >= $2 AND pu."appliedAt" <= $3
      WHERE p."tenantId" = $1
      GROUP BY p.id, p.name, p.type, p."discountType"
      ORDER BY total_uses DESC
    `;

      const result = await executeQuery(usageQuery, [tenantId, start, end]);
      const analytics = result.rows.map((row: any) => ({
        ...row,
        total_uses: parseInt(row.total_uses),
        total_discount_given: parseFloat(row.total_discount_given || 0),
        total_original_amount: parseFloat(row.total_original_amount || 0),
        avg_discount_per_use: parseFloat(row.avg_discount_per_use || 0),
      }));

      sendSuccess(res, { analytics, period: { start, end } });
    } catch (error) {
      logger.error("Promotion analytics error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch promotion analytics");
    }
  }
);

// ==================== HELPER FUNCTIONS ====================

async function getPromotionWithItems(promotionId: string) {
  const promotionQuery = `
    SELECT p.*,
           pi.id as item_id, pi."menuItemId", pi."categoryId", pi."requiredQuantity",
           pi."freeQuantity", pi."discountedPrice", pi."isRequired", pi."maxQuantity",
           mi.name as menu_item_name, c.name as category_name
    FROM promotions p
    LEFT JOIN "promotionItems" pi ON p.id = pi."promotionId"
    LEFT JOIN "menuItems" mi ON pi."menuItemId" = mi.id
    LEFT JOIN categories c ON pi."categoryId" = c.id
    WHERE p.id = $1
  `;

  const result = await executeQuery(promotionQuery, [promotionId]);
  const rows = result.rows;

  if (rows.length === 0) return null;

  const promotion = {
    id: rows[0].id,
    tenantId: rows[0].tenantId,
    name: rows[0].name,
    description: rows[0].description,
    type: rows[0].type,
    discountType: rows[0].discountType,
    discountValue: rows[0].discountValue,
    fixedPrice: rows[0].fixedPrice,
    minCartValue: rows[0].minCartValue,
    maxDiscountAmount: rows[0].maxDiscountAmount,
    minItems: rows[0].minItems,
    maxItems: rows[0].maxItems,
    usageLimit: rows[0].usageLimit,
    usageCount: rows[0].usageCount,
    perCustomerLimit: rows[0].perCustomerLimit,
    startDate: rows[0].startDate,
    endDate: rows[0].endDate,
    timeRangeStart: rows[0].timeRangeStart,
    timeRangeEnd: rows[0].timeRangeEnd,
    daysOfWeek: rows[0].daysOfWeek,
    requiresCode: rows[0].requiresCode,
    promoCode: rows[0].promoCode,
    autoApply: rows[0].autoApply,
    customerSegments: rows[0].customerSegments,
    customerTypes: rows[0].customerTypes,
    priority: rows[0].priority,
    canCombineWithOthers: rows[0].canCombineWithOthers,
    isActive: rows[0].isActive,
    createdAt: rows[0].createdAt,
    updatedAt: rows[0].updatedAt,
    createdBy: rows[0].createdBy,
    items: rows
      .filter((row) => row.item_id)
      .map((row) => ({
        id: row.item_id,
        menuItemId: row.menuItemId,
        categoryId: row.categoryId,
        requiredQuantity: row.requiredQuantity,
        freeQuantity: row.freeQuantity,
        discountedPrice: row.discountedPrice,
        isRequired: row.isRequired,
        maxQuantity: row.maxQuantity,
        menuItemName: row.menu_item_name,
        categoryName: row.category_name,
      })),
  };

  return promotion;
}

async function validatePromotionConditions(promotion: any, context: any) {
  const { customerPhone, orderItems, cartTotal, tenantId } = context;

  // Check date range
  if (promotion.startDate && new Date() < new Date(promotion.startDate)) {
    return { isValid: false, reason: "Promotion has not started yet" };
  }

  if (promotion.endDate && new Date() > new Date(promotion.endDate)) {
    return { isValid: false, reason: "Promotion has expired" };
  }

  // Check time range
  if (promotion.timeRangeStart && promotion.timeRangeEnd) {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
    const startTime =
      parseInt(promotion.timeRangeStart.split(":")[0]) * 60 +
      parseInt(promotion.timeRangeStart.split(":")[1]);
    const endTime =
      parseInt(promotion.timeRangeEnd.split(":")[0]) * 60 +
      parseInt(promotion.timeRangeEnd.split(":")[1]);

    if (currentTime < startTime || currentTime > endTime) {
      return {
        isValid: false,
        reason: `Promotion is only valid between ${promotion.timeRangeStart} and ${promotion.timeRangeEnd}`,
      };
    }
  }

  // Check days of week
  if (promotion.daysOfWeek && promotion.daysOfWeek.length > 0) {
    const today = new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.
    const adjustedToday = today === 0 ? 7 : today; // Convert to 1-7 format
    if (!promotion.daysOfWeek.includes(adjustedToday)) {
      return {
        isValid: false,
        reason: "Promotion is not valid on this day of the week",
      };
    }
  }

  // Check minimum cart value
  if (promotion.minCartValue && cartTotal < promotion.minCartValue) {
    return {
      isValid: false,
      reason: `Minimum order value of ${promotion.minCartValue} required`,
    };
  }

  // Check usage limits
  if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
    return { isValid: false, reason: "Promotion usage limit reached" };
  }

  // Check per-customer limits
  if (promotion.perCustomerLimit && customerPhone) {
    const customerUsageResult = await executeQuery(
      'SELECT "usageCount" FROM "customerPromotionUsage" WHERE "customerPhone" = $1 AND "promotionId" = $2 AND "tenantId" = $3',
      [customerPhone, promotion.id, tenantId]
    );

    if (
      customerUsageResult.rows.length > 0 &&
      customerUsageResult.rows[0].usageCount >= promotion.perCustomerLimit
    ) {
      return {
        isValid: false,
        reason: "Customer usage limit reached for this promotion",
      };
    }
  }

  // Calculate estimated discount (simplified)
  let estimatedDiscount = 0;
  if (promotion.discountType === "PERCENTAGE") {
    estimatedDiscount = (cartTotal * promotion.discountValue) / 100;
    if (
      promotion.maxDiscountAmount &&
      estimatedDiscount > promotion.maxDiscountAmount
    ) {
      estimatedDiscount = promotion.maxDiscountAmount;
    }
  } else if (promotion.discountType === "FIXED_AMOUNT") {
    estimatedDiscount = Math.min(promotion.discountValue, cartTotal);
  }

  return { isValid: true, estimatedDiscount };
}

export default router;
