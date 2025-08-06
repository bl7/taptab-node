import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== MENU ITEM INGREDIENTS MANAGEMENT ====================

// GET /api/v1/menu-items/:menuItemId/ingredients - Get ingredients for a menu item
router.get(
  "/:menuItemId/ingredients",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { menuItemId } = req.params;

      if (!menuItemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID is required",
          400
        );
      }

      // Verify menu item exists and belongs to tenant
      const menuItemCheck = await executeQuery(
        'SELECT id FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
        [menuItemId, tenantId]
      );

      if (menuItemCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Menu item not found", 404);
      }

      // Get ingredients for the menu item
      const query = `
      SELECT i.*, mii.quantity, mii.unit
      FROM ingredients i
      INNER JOIN "menuItemIngredients" mii ON i.id = mii."ingredientId"
      WHERE mii."menuItemId" = $1 AND i."tenantId" = $2
      ORDER BY i.name ASC
    `;

      const result = await executeQuery(query, [menuItemId, tenantId]);

      const formattedIngredients = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        unit: row.unit,
        costPerUnit: row.costPerUnit,
        quantity: row.quantity,
        menuItemUnit: row.menuItemUnit,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      sendSuccess(res, { ingredients: formattedIngredients });
    } catch (error) {
      logger.error("Get menu item ingredients error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch menu item ingredients");
    }
  }
);

// POST /api/v1/menu-items/:menuItemId/ingredients - Add ingredient to menu item
router.post(
  "/:menuItemId/ingredients",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { menuItemId } = req.params;
      const { ingredientId, quantity, unit } = req.body;

      if (!menuItemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID is required",
          400
        );
      }

      if (!ingredientId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Ingredient ID is required",
          400
        );
      }

      if (!quantity || quantity <= 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Quantity must be greater than 0",
          400
        );
      }

      // Verify menu item exists and belongs to tenant
      const menuItemCheck = await executeQuery(
        'SELECT id FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
        [menuItemId, tenantId]
      );

      if (menuItemCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Menu item not found", 404);
      }

      // Verify ingredient exists and belongs to tenant
      const ingredientCheck = await executeQuery(
        'SELECT id FROM ingredients WHERE id = $1 AND "tenantId" = $2',
        [ingredientId, tenantId]
      );

      if (ingredientCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Ingredient not found", 404);
      }

      // Check if ingredient is already associated with this menu item
      const existingCheck = await executeQuery(
        'SELECT id FROM "menuItemIngredients" WHERE "menuItemId" = $1 AND "ingredientId" = $2',
        [menuItemId, ingredientId]
      );

      if (existingCheck.rows.length > 0) {
        return sendError(
          res,
          "DUPLICATE_ERROR",
          "Ingredient is already associated with this menu item",
          409
        );
      }

      // Add ingredient to menu item
      const menuItemIngredientData = {
        id: `mii_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        menuItemId,
        ingredientId,
        quantity,
        unit: unit || "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const fields = Object.keys(menuItemIngredientData);
      const values = Object.values(menuItemIngredientData);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const fieldNames = fields.map((field) => `"${field}"`).join(", ");

      const insertQuery = `INSERT INTO "menuItemIngredients" (${fieldNames}) VALUES (${placeholders}) RETURNING *`;
      const result = await executeQuery(insertQuery, values);

      logger.info(
        `Ingredient added to menu item: ${ingredientId} -> ${menuItemId}`
      );
      sendSuccess(
        res,
        { menuItemIngredient: result.rows[0] },
        "Ingredient added to menu item successfully",
        201
      );
    } catch (error) {
      logger.error("Add ingredient to menu item error:", error);
      sendError(res, "CREATE_ERROR", "Failed to add ingredient to menu item");
    }
  }
);

// PUT /api/v1/menu-items/:menuItemId/ingredients/:ingredientId - Update ingredient quantity in menu item
router.put(
  "/:menuItemId/ingredients/:ingredientId",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { menuItemId, ingredientId } = req.params;
      const { quantity, unit } = req.body;

      if (!menuItemId || !ingredientId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID and ingredient ID are required",
          400
        );
      }

      if (!quantity || quantity <= 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Quantity must be greater than 0",
          400
        );
      }

      // Verify the relationship exists
      const relationshipCheck = await executeQuery(
        'SELECT id FROM "menuItemIngredients" WHERE "menuItemId" = $1 AND "ingredientId" = $2',
        [menuItemId, ingredientId]
      );

      if (relationshipCheck.rows.length === 0) {
        return sendError(
          res,
          "NOT_FOUND",
          "Ingredient is not associated with this menu item",
          404
        );
      }

      // Update the relationship
      const updateQuery = `
      UPDATE "menuItemIngredients" 
      SET quantity = $1, unit = $2, "updatedAt" = $3
      WHERE "menuItemId" = $4 AND "ingredientId" = $5
      RETURNING *
    `;

      const result = await executeQuery(updateQuery, [
        quantity,
        unit || "",
        new Date(),
        menuItemId,
        ingredientId,
      ]);

      logger.info(
        `Menu item ingredient updated: ${menuItemId} -> ${ingredientId}`
      );
      sendSuccess(
        res,
        { menuItemIngredient: result.rows[0] },
        "Menu item ingredient updated successfully"
      );
    } catch (error) {
      logger.error("Update menu item ingredient error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update menu item ingredient");
    }
  }
);

// DELETE /api/v1/menu-items/:menuItemId/ingredients/:ingredientId - Remove ingredient from menu item
router.delete(
  "/:menuItemId/ingredients/:ingredientId",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { menuItemId, ingredientId } = req.params;

      if (!menuItemId || !ingredientId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID and ingredient ID are required",
          400
        );
      }

      // Verify the relationship exists
      const relationshipCheck = await executeQuery(
        'SELECT id FROM "menuItemIngredients" WHERE "menuItemId" = $1 AND "ingredientId" = $2',
        [menuItemId, ingredientId]
      );

      if (relationshipCheck.rows.length === 0) {
        return sendError(
          res,
          "NOT_FOUND",
          "Ingredient is not associated with this menu item",
          404
        );
      }

      // Remove the relationship
      const deleteQuery =
        'DELETE FROM "menuItemIngredients" WHERE "menuItemId" = $1 AND "ingredientId" = $2';
      await executeQuery(deleteQuery, [menuItemId, ingredientId]);

      logger.info(
        `Ingredient removed from menu item: ${ingredientId} -> ${menuItemId}`
      );
      sendSuccess(
        res,
        { success: true },
        "Ingredient removed from menu item successfully"
      );
    } catch (error) {
      logger.error("Remove ingredient from menu item error:", error);
      sendError(
        res,
        "DELETE_ERROR",
        "Failed to remove ingredient from menu item"
      );
    }
  }
);

export default router;
