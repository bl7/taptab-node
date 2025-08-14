import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== INGREDIENT ALLERGENS MANAGEMENT ====================

// GET /api/v1/ingredients/:ingredientId/allergens - Get allergens for an ingredient
router.get(
  "/:ingredientId/allergens",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { ingredientId } = req.params;

      if (!ingredientId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Ingredient ID is required",
          400
        );
      }

      // Verify ingredient exists and belongs to tenant
      const ingredientCheck = await executeQuery(
        "SELECT id FROM ingredients WHERE id = $1 AND tenantId = $2",
        [ingredientId, tenantId]
      );

      if (ingredientCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Ingredient not found", 404);
      }

      // Get all allergens for the ingredient
      const allergensResult = await executeQuery(
        `SELECT a.*, ia."ingredientId"
         FROM allergens a
         JOIN "ingredientAllergens" ia ON a.id = ia."allergenId"
         WHERE ia."ingredientId" = $1
         ORDER BY a.name ASC`,
        [ingredientId]
      );

      const formattedAllergens = allergensResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        severity: row.severity,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      sendSuccess(res, { allergens: formattedAllergens });
    } catch (error) {
      logger.error("Get ingredient allergens error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch ingredient allergens");
    }
  }
);

// POST /api/v1/ingredients/:ingredientId/allergens - Add allergen to ingredient
router.post(
  "/:ingredientId/allergens",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { ingredientId } = req.params;
      const { allergenId } = req.body;

      if (!ingredientId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Ingredient ID is required",
          400
        );
      }

      if (!allergenId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Allergen ID is required",
          400
        );
      }

      // Verify ingredient exists and belongs to tenant
      const ingredientCheck = await executeQuery(
        "SELECT id FROM ingredients WHERE id = $1 AND tenantId = $2",
        [ingredientId, tenantId]
      );

      if (ingredientCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Ingredient not found", 404);
      }

      // Verify allergen exists and belongs to tenant
      const allergenCheck = await executeQuery(
        'SELECT id FROM allergens WHERE id = $1 AND "tenantId" = $2',
        [allergenId, tenantId]
      );

      if (allergenCheck.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Allergen not found", 404);
      }

      // Check if allergen is already associated with this ingredient
      const existingCheck = await executeQuery(
        'SELECT id FROM "ingredientAllergens" WHERE "ingredientId" = $1 AND "allergenId" = $2',
        [ingredientId, allergenId]
      );

      if (existingCheck.rows.length > 0) {
        return sendError(
          res,
          "DUPLICATE_ERROR",
          "Allergen is already associated with this ingredient",
          409
        );
      }

      // Add allergen to ingredient
      const ingredientAllergenData = {
        id: `ial_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        ingredientId,
        allergenId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const fields = Object.keys(ingredientAllergenData);
      const values = Object.values(ingredientAllergenData);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const fieldNames = fields.map((field) => `"${field}"`).join(", ");

      const insertQuery = `INSERT INTO "ingredientAllergens" (${fieldNames}) VALUES (${placeholders}) RETURNING *`;
      const result = await executeQuery(insertQuery, values);

      logger.info(
        `Allergen added to ingredient: ${allergenId} -> ${ingredientId}`
      );
      sendSuccess(
        res,
        { ingredientAllergen: result.rows[0] },
        "Allergen added to ingredient successfully",
        201
      );
    } catch (error) {
      logger.error("Add allergen to ingredient error:", error);
      sendError(res, "CREATE_ERROR", "Failed to add allergen to ingredient");
    }
  }
);

// DELETE /api/v1/ingredients/:ingredientId/allergens/:allergenId - Remove allergen from ingredient
router.delete(
  "/:ingredientId/allergens/:allergenId",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const { ingredientId, allergenId } = req.params;

      if (!ingredientId || !allergenId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Ingredient ID and allergen ID are required",
          400
        );
      }

      // Verify the relationship exists
      const relationshipCheck = await executeQuery(
        'SELECT id FROM "ingredientAllergens" WHERE "ingredientId" = $1 AND "allergenId" = $2',
        [ingredientId, allergenId]
      );

      if (relationshipCheck.rows.length === 0) {
        return sendError(
          res,
          "NOT_FOUND",
          "Allergen is not associated with this ingredient",
          404
        );
      }

      // Remove the relationship
      const deleteQuery =
        'DELETE FROM "ingredientAllergens" WHERE "ingredientId" = $1 AND "allergenId" = $2';
      await executeQuery(deleteQuery, [ingredientId, allergenId]);

      logger.info(
        `Allergen removed from ingredient: ${allergenId} -> ${ingredientId}`
      );
      sendSuccess(
        res,
        { success: true },
        "Allergen removed from ingredient successfully"
      );
    } catch (error) {
      logger.error("Remove allergen from ingredient error:", error);
      sendError(
        res,
        "DELETE_ERROR",
        "Failed to remove allergen from ingredient"
      );
    }
  }
);

// GET /api/v1/menu-items/:menuItemId/allergens - Get all allergens for a menu item (including from ingredients)
router.get(
  "/menu-items/:menuItemId/allergens",
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

      // Get all allergens for the menu item through its ingredients
      const query = `
      SELECT DISTINCT a.*
      FROM allergens a
      INNER JOIN "ingredientAllergens" ia ON a.id = ia."allergenId"
      INNER JOIN "menuItemIngredients" mii ON ia."ingredientId" = mii."ingredientId"
      WHERE mii."menuItemId" = $1 AND a."tenantId" = $2
      ORDER BY a.name ASC
    `;

      const result = await executeQuery(query, [menuItemId, tenantId]);

      const formattedAllergens = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        severity: row.severity,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      sendSuccess(res, { allergens: formattedAllergens });
    } catch (error) {
      logger.error("Get menu item allergens error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch menu item allergens");
    }
  }
);

export default router;
