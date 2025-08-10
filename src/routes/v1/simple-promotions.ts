import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";
import { SimplePromotions, Promotion } from "../../services/simple-promotions";

const router = Router();

// ==================== SIMPLE PROMOTIONS API ====================

// GET /api/v1/simple-promotions - Get all promotions
router.get(
  "/",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { active, type } = req.query;

      let query = `
        SELECT 
          id, name, description, type, discount_value, min_order_amount, max_discount_amount,
          buy_quantity, get_quantity, start_time, end_time, days_of_week,
          target_type, target_category_id, target_product_ids, priority, "startDate", "endDate", "tenantId", "isActive", "createdAt", "updatedAt",
          buy_target_type, buy_target_category_id, buy_target_product_ids,
          get_target_type, get_target_category_id, get_target_product_ids
        FROM promotions 
        WHERE "tenantId" = $1
      `;
      const values: any[] = [tenantId];

      if (active !== undefined) {
        query += ` AND "isActive" = $${values.length + 1}`;
        values.push(active === "true");
      }

      if (type) {
        query += ` AND type = $${values.length + 1}`;
        values.push(type);
      }

      query += ` ORDER BY priority DESC, "createdAt" DESC`;

      const result = await executeQuery(query, values);
      sendSuccess(res, { promotions: result.rows });
    } catch (error) {
      logger.error("Get promotions error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch promotions");
    }
  }
);

// POST /api/v1/simple-promotions - Create new promotion
router.post(
  "/",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const {
        name,
        description,
        type,
        discount_value,
        min_order_amount = 0,
        max_discount_amount,
        buy_quantity = 1,
        get_quantity = 1,
        start_time,
        end_time,
        days_of_week,
        target_type = "ALL",
        target_category_id,
        target_product_ids = [],
        priority = 1,
        startDate,
        endDate,
        // BOGO specific fields
        buy_target_type = "ALL",
        buy_target_category_id,
        buy_target_product_ids = [],
        get_target_type = "ALL",
        get_target_category_id,
        get_target_product_ids = [],
      } = req.body;

      // Validation
      if (!name || !type) {
        return sendError(res, "VALIDATION_ERROR", "Name and type are required");
      }

      // Validate promotion type matches database constraints
      const validTypes = ["HAPPY_HOUR", "BOGO", "PERCENTAGE_OFF", "FIXED_OFF"];
      if (!validTypes.includes(type)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid promotion type. Must be one of: ${validTypes.join(", ")}`
        );
      }

      // Validate targeting types match database constraints
      const validTargetTypes = ["ALL", "CATEGORY", "PRODUCTS"];
      if (target_type && !validTargetTypes.includes(target_type)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid target_type. Must be one of: ${validTargetTypes.join(", ")}`
        );
      }
      if (buy_target_type && !validTargetTypes.includes(buy_target_type)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid buy_target_type. Must be one of: ${validTargetTypes.join(
            ", "
          )}`
        );
      }
      if (get_target_type && !validTargetTypes.includes(get_target_type)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          `Invalid get_target_type. Must be one of: ${validTargetTypes.join(
            ", "
          )}`
        );
      }

      // DEBUG: Log what we're about to insert
      console.log("DEBUG - About to insert promotion with values:", {
        buy_target_type,
        buy_target_category_id,
        get_target_type,
        get_target_category_id,
        target_type,
        target_category_id,
      });

      // COMPREHENSIVE VALIDATION: Check ALL category IDs exist, regardless of target type
      const allCategoryIds = [
        target_category_id,
        buy_target_category_id,
        get_target_category_id,
      ].filter((id) => id); // Remove null/undefined values

      console.log("DEBUG - Category IDs to validate:", allCategoryIds);
      console.log("DEBUG - Current tenantId:", tenantId);

      for (const categoryId of allCategoryIds) {
        if (categoryId) {
          console.log(`DEBUG - Validating category ID: ${categoryId}`);
          try {
            const categoryCheck = await executeQuery(
              'SELECT id FROM categories WHERE id = $1 AND "tenantId" = $2',
              [categoryId, tenantId]
            );
            console.log(
              `DEBUG - Category check result for ${categoryId}:`,
              categoryCheck.rows
            );
            if (categoryCheck.rows.length === 0) {
              console.log(
                `DEBUG - Category ${categoryId} not found, returning error`
              );
              return sendError(
                res,
                "VALIDATION_ERROR",
                `Category with ID ${categoryId} does not exist in your tenant`
              );
            }
          } catch (error) {
            console.log(
              `DEBUG - Error checking category ${categoryId}:`,
              error
            );
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return sendError(
              res,
              "VALIDATION_ERROR",
              `Error validating category ID ${categoryId}: ${errorMessage}`
            );
          }
        }
      }

      console.log("DEBUG - All category validations passed successfully");

      if (type === "HAPPY_HOUR" && (!start_time || !end_time)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Happy hour promotions require start_time and end_time"
        );
      }

      if (type === "BOGO" && (!buy_quantity || !get_quantity)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "BOGO promotions require buy_quantity and get_quantity"
        );
      }

      // Validate discount_value for non-BOGO promotions
      if (type !== "BOGO" && !discount_value) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Discount value is required for non-BOGO promotions"
        );
      }

      // Handle time fields - convert empty strings to null
      const startTime =
        start_time && start_time.trim() !== "" ? start_time : null;
      const endTime = end_time && end_time.trim() !== "" ? end_time : null;

      // Convert days_of_week to integer array if provided
      let daysOfWeekInt: number[] | null = null;
      if (days_of_week && Array.isArray(days_of_week)) {
        daysOfWeekInt = days_of_week.map((day) => {
          if (typeof day === "string") {
            // Convert day names to numbers (Monday=1, Sunday=7)
            const dayMap: { [key: string]: number } = {
              monday: 1,
              tuesday: 2,
              wednesday: 3,
              thursday: 4,
              friday: 5,
              saturday: 6,
              sunday: 7,
            };
            return dayMap[day.toLowerCase()] || parseInt(day);
          }
          return parseInt(day.toString());
        });
      }

      // Handle array fields - ensure they're not empty arrays if they should be null
      const targetProductIds =
        target_product_ids &&
        Array.isArray(target_product_ids) &&
        target_product_ids.length > 0
          ? target_product_ids
          : null;
      const buyTargetProductIds =
        buy_target_product_ids &&
        Array.isArray(buy_target_product_ids) &&
        buy_target_product_ids.length > 0
          ? buy_target_product_ids
          : null;
      const getTargetProductIds =
        get_target_product_ids &&
        Array.isArray(get_target_product_ids) &&
        get_target_product_ids.length > 0
          ? get_target_product_ids
          : null;

      // Generate ID
      const id = `promo_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`;

      const query = `
        INSERT INTO promotions (
          id, name, description, type, discount_value, min_order_amount, max_discount_amount,
          buy_quantity, get_quantity, start_time, end_time, days_of_week,
          target_type, target_category_id, target_product_ids, priority, "startDate", "endDate", "tenantId",
          buy_target_type, buy_target_category_id, buy_target_product_ids,
          get_target_type, get_target_category_id, get_target_product_ids
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25
        ) RETURNING *
      `;

      const values = [
        id,
        name,
        description,
        type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        buy_quantity,
        get_quantity,
        startTime,
        endTime,
        daysOfWeekInt,
        target_type,
        target_category_id,
        targetProductIds,
        priority,
        startDate,
        endDate,
        tenantId,
        buy_target_type,
        buy_target_category_id,
        buyTargetProductIds,
        get_target_type,
        get_target_category_id,
        getTargetProductIds,
      ];

      const result = await executeQuery(query, values);
      sendSuccess(
        res,
        { promotion: result.rows[0] },
        "Promotion created successfully"
      );
    } catch (error) {
      logger.error("Create promotion error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create promotion");
    }
  }
);

// PUT /api/v1/simple-promotions/:id - Update promotion
router.put(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const updateData = req.body;

      // Check if promotion exists and belongs to tenant
      const checkQuery = `SELECT id FROM promotions WHERE id = $1 AND "tenantId" = $2`;
      const checkResult = await executeQuery(checkQuery, [id, tenantId]);

      if (checkResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Promotion not found");
      }

      // Build update query dynamically
      const allowedFields = [
        "name",
        "description",
        "type",
        "discount_value",
        "min_order_amount",
        "max_discount_amount",
        "buy_quantity",
        "get_quantity",
        "start_time",
        "end_time",
        "days_of_week",
        "target_type",
        "target_category_id",
        "target_product_ids",
        "priority",
        "startDate",
        "endDate",
        "isActive",
        // BOGO specific fields
        "buy_target_type",
        "buy_target_category_id",
        "buy_target_product_ids",
        "get_target_type",
        "get_target_category_id",
        "get_target_product_ids",
      ];

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          // Handle days_of_week conversion
          if (key === "days_of_week" && value && Array.isArray(value)) {
            const daysOfWeekInt = value.map((day) => {
              if (typeof day === "string") {
                const dayMap: { [key: string]: number } = {
                  monday: 1,
                  tuesday: 2,
                  wednesday: 3,
                  thursday: 4,
                  friday: 5,
                  saturday: 6,
                  sunday: 7,
                };
                return dayMap[day.toLowerCase()] || parseInt(day);
              }
              return parseInt(day.toString());
            });
            updates.push(`"${key}" = $${paramCount + 1}`);
            values.push(daysOfWeekInt);
          } else if (key === "start_time" || key === "end_time") {
            // Handle time fields - convert empty strings to null
            const timeValue =
              value && typeof value === "string" && value.trim() !== ""
                ? value
                : null;
            updates.push(`"${key}" = $${paramCount + 1}`);
            values.push(timeValue);
          } else {
            updates.push(`"${key}" = $${paramCount + 1}`);
            values.push(value);
          }
          paramCount++;
        }
      }

      if (updates.length === 0) {
        return sendError(res, "VALIDATION_ERROR", "No valid fields to update");
      }

      updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
      values.push(id, tenantId);

      const query = `
        UPDATE promotions 
        SET ${updates.join(", ")}
        WHERE id = $${paramCount + 1} AND "tenantId" = $${paramCount + 2}
        RETURNING *
      `;

      const result = await executeQuery(query, values);
      sendSuccess(
        res,
        { promotion: result.rows[0] },
        "Promotion updated successfully"
      );
    } catch (error) {
      logger.error("Update promotion error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update promotion");
    }
  }
);

// DELETE /api/v1/simple-promotions/:id - Delete promotion
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      const query = `DELETE FROM promotions WHERE id = $1 AND "tenantId" = $2 RETURNING id`;
      const result = await executeQuery(query, [id, tenantId]);

      if (result.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Promotion not found");
      }

      sendSuccess(res, {}, "Promotion deleted successfully");
    } catch (error) {
      logger.error("Delete promotion error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete promotion");
    }
  }
);

// POST /api/v1/simple-promotions/calculate - Calculate promotions for order
router.post(
  "/calculate",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { orderItems, orderTime } = req.body;

      if (!orderItems || !Array.isArray(orderItems)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "orderItems array is required"
        );
      }

      const promotions = await SimplePromotions.calculatePromotions(
        orderItems,
        tenantId,
        orderTime ? new Date(orderTime) : new Date()
      );

      const totalDiscount = promotions.reduce(
        (sum, p) => sum + p.discountAmount,
        0
      );
      const subtotal = orderItems.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
      );
      const finalAmount = subtotal - totalDiscount;

      sendSuccess(res, {
        promotions,
        subtotal,
        totalDiscount,
        finalAmount,
      });
    } catch (error) {
      logger.error("Calculate promotions error:", error);
      sendError(res, "CALCULATION_ERROR", "Failed to calculate promotions");
    }
  }
);

// GET /api/v1/simple-promotions/active - Get currently active promotions
router.get(
  "/active",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "KITCHEN", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const promotions = await SimplePromotions.getActivePromotions(tenantId);

      sendSuccess(res, { promotions });
    } catch (error) {
      logger.error("Get active promotions error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch active promotions");
    }
  }
);

// PUBLIC ROUTES (No authentication required)
// These are for customer-facing pages like public menus, public order pages

// GET /api/v1/simple-promotions/public/active - Get active promotions for public display
router.get("/public/active", async (req: Request, res: Response) => {
  try {
    // Get tenant from query parameter or subdomain
    const tenantId = req.query.tenantId as string;

    if (!tenantId) {
      return sendError(res, "VALIDATION_ERROR", "tenantId is required");
    }

    const promotions = await SimplePromotions.getActivePromotions(tenantId);

    sendSuccess(res, { promotions });
  } catch (error) {
    logger.error("Get public active promotions error:", error);
    sendError(res, "INTERNAL_ERROR", "Failed to fetch active promotions");
  }
});

// POST /api/v1/simple-promotions/public/calculate - Calculate promotions for public order preview
router.post("/public/calculate", async (req: Request, res: Response) => {
  try {
    const { orderItems, tenantId, orderTime } = req.body;

    // Validation
    if (!orderItems || !Array.isArray(orderItems)) {
      return sendError(res, "VALIDATION_ERROR", "orderItems array is required");
    }

    if (!tenantId) {
      return sendError(res, "VALIDATION_ERROR", "tenantId is required");
    }

    // Calculate promotions
    const promotions = await SimplePromotions.calculatePromotions(
      orderItems,
      tenantId,
      orderTime ? new Date(orderTime) : new Date()
    );

    // Calculate totals
    const totalDiscount = promotions.reduce(
      (sum, p) => sum + p.discountAmount,
      0
    );
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
    const finalAmount = subtotal - totalDiscount;

    sendSuccess(res, {
      promotions,
      orderSummary: {
        subtotal,
        totalDiscount,
        finalAmount,
      },
    });
  } catch (error) {
    logger.error("Public calculate promotions error:", error);
    sendError(res, "INTERNAL_ERROR", "Failed to calculate promotions");
  }
});

export default router;
