import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import {
  findMany,
  createWithCheck,
  updateWithCheck,
  deleteWithCheck,
  findById,
  executeQuery,
} from "../../utils/database";

const router = Router();

// ==================== INGREDIENTS MANAGEMENT ====================

// GET /api/v1/ingredients - Get all ingredients (AUTHENTICATED)
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { search, page = 1, limit = 50 } = req.query;

    let conditions: any = { tenantId: tenantId };

    if (search) {
      // For search, we'll need to use a custom query since findMany doesn't support LIKE
      const offset = (Number(page) - 1) * Number(limit);
      const searchQuery = `
        SELECT * FROM ingredients 
        WHERE "tenantId" = $1 
        AND (name ILIKE $2 OR description ILIKE $2)
        ORDER BY name ASC
        LIMIT $3 OFFSET $4
      `;
      const searchValue = `%${search}%`;
      const { executeQuery } = await import("../../utils/database");
      const result = await executeQuery(searchQuery, [
        tenantId,
        searchValue,
        limit,
        offset,
      ]);

      const formattedIngredients = result.rows.map((ingredient: any) => ({
        id: ingredient.id,
        name: ingredient.name,
        description: ingredient.description,
        unit: ingredient.unit,
        costPerUnit: ingredient.costPerUnit,
        isActive: ingredient.isActive,
        createdAt: ingredient.createdAt,
        updatedAt: ingredient.updatedAt,
      }));

      return sendSuccess(res, {
        ingredients: formattedIngredients,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.rows.length,
        },
      });
    }

    // Use executeQuery instead of findMany to avoid column name quoting issues
    let query = `SELECT * FROM ingredients`;
    const values: any[] = [];
    let whereClause = "";

    if (Object.keys(conditions).length > 0) {
      const conditionsArray = Object.entries(conditions).map(
        ([key, value], index) => {
          values.push(value);
          return `${key} = $${index + 1}`;
        }
      );
      whereClause = `WHERE ${conditionsArray.join(" AND ")}`;
    }

    query += ` ${whereClause} ORDER BY name ASC`;
    const result = await executeQuery(query, values);
    const ingredients = result.rows;

    const formattedIngredients = ingredients.map((ingredient: any) => ({
      id: ingredient.id,
      name: ingredient.name,
      description: ingredient.description,
      unit: ingredient.unit,
      costPerUnit: ingredient.costPerUnit,
      isActive: ingredient.isActive,
      createdAt: ingredient.createdAt,
      updatedAt: ingredient.updatedAt,
    }));

    sendSuccess(res, { ingredients: formattedIngredients });
  } catch (error) {
    logger.error("Get ingredients error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch ingredients");
  }
});

// GET /api/v1/ingredients/:id - Get ingredient by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    if (!id) {
      return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
    }

    const ingredient = await findById("ingredients", id, tenantId);

    const formattedIngredient = {
      id: ingredient.id,
      name: ingredient.name,
      description: ingredient.description,
      unit: ingredient.unit,
      costPerUnit: ingredient.costPerUnit,
      isActive: ingredient.isActive,
      createdAt: ingredient.createdAt,
      updatedAt: ingredient.updatedAt,
    };

    sendSuccess(res, { ingredient: formattedIngredient });
  } catch (error) {
    logger.error("Get ingredient error:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      sendError(res, "NOT_FOUND", "Ingredient not found", 404);
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch ingredient");
    }
  }
});

// POST /api/v1/ingredients - Create new ingredient
router.post(
  "/",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { name, description, unit, costPerUnit = 0 } = req.body;

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      const ingredientData = {
        id: `ing_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name,
        description: description || "",
        unit: unit || "",
        costPerUnit: costPerUnit || 0,
        tenantId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ingredient = await createWithCheck(
        "ingredients",
        ingredientData,
        "name",
        name,
        tenantId
      );

      const formattedIngredient = {
        id: ingredient.id,
        name: ingredient.name,
        description: ingredient.description,
        unit: ingredient.unit,
        costPerUnit: ingredient.costPerUnit,
        isActive: ingredient.isActive,
        createdAt: ingredient.createdAt,
        updatedAt: ingredient.updatedAt,
      };

      logger.info(`Ingredient created: ${ingredient.name}`);
      sendSuccess(
        res,
        { ingredient: formattedIngredient },
        "Ingredient created successfully",
        201
      );
    } catch (error) {
      logger.error("Create ingredient error:", error);
      if (error instanceof Error && error.message.includes("already exists")) {
        sendError(
          res,
          "DUPLICATE_ERROR",
          "Ingredient with this name already exists",
          409
        );
      } else {
        sendError(res, "CREATE_ERROR", "Failed to create ingredient");
      }
    }
  }
);

// PUT /api/v1/ingredients/:id - Update ingredient
router.put(
  "/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { name, description, unit, costPerUnit, isActive } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      const updateData = {
        name,
        description: description || "",
        unit: unit || "",
        costPerUnit: costPerUnit || 0,
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      };

      const ingredient = await updateWithCheck(
        "ingredients",
        id,
        updateData,
        tenantId
      );

      const formattedIngredient = {
        id: ingredient.id,
        name: ingredient.name,
        description: ingredient.description,
        unit: ingredient.unit,
        costPerUnit: ingredient.costPerUnit,
        isActive: ingredient.isActive,
        createdAt: ingredient.createdAt,
        updatedAt: ingredient.updatedAt,
      };

      logger.info(`Ingredient updated: ${ingredient.name}`);
      sendSuccess(
        res,
        { ingredient: formattedIngredient },
        "Ingredient updated successfully"
      );
    } catch (error) {
      logger.error("Update ingredient error:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        sendError(res, "NOT_FOUND", "Ingredient not found", 404);
      } else {
        sendError(res, "UPDATE_ERROR", "Failed to update ingredient");
      }
    }
  }
);

// DELETE /api/v1/ingredients/:id - Delete ingredient
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Check if ingredient is used in any menu items before deleting
      const { executeQuery } = await import("../../utils/database");
      const usageCheck = await executeQuery(
        'SELECT COUNT(*) as count FROM "menuItemIngredients" WHERE "ingredientId" = $1',
        [id]
      );

      if (usageCheck.rows[0].count > 0) {
        return sendError(
          res,
          "DEPENDENCY_ERROR",
          "Cannot delete ingredient that is used in menu items",
          400
        );
      }

      await deleteWithCheck("ingredients", id, tenantId);

      logger.info(`Ingredient deleted: ${id}`);
      sendSuccess(res, { success: true }, "Ingredient deleted successfully");
    } catch (error) {
      logger.error("Delete ingredient error:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        sendError(res, "NOT_FOUND", "Ingredient not found", 404);
      } else {
        sendError(res, "DELETE_ERROR", "Failed to delete ingredient");
      }
    }
  }
);

export default router;
