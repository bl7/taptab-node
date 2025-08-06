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

// ==================== ALLERGENS MANAGEMENT ====================

// GET /api/v1/allergens - Get all allergens (AUTHENTICATED)
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { search, page = 1, limit = 50 } = req.query;

    // For allergens, we need to get both standard allergens (shared) and custom allergens (tenant-specific)
    if (search) {
      // For search, we'll need to use a custom query since findMany doesn't support LIKE
      const offset = (Number(page) - 1) * Number(limit);
      const searchQuery = `
        SELECT * FROM allergens 
        WHERE (tenantId = $1 OR (isStandard = true AND tenantId IS NULL))
        AND (name ILIKE $2 OR description ILIKE $2)
        ORDER BY isStandard DESC, name ASC
        LIMIT $3 OFFSET $4
      `;
      const searchValue = `%${search}%`;
      const result = await executeQuery(searchQuery, [
        tenantId,
        searchValue,
        limit,
        offset,
      ]);

      const formattedAllergens = result.rows.map((allergen: any) => ({
        id: allergen.id,
        name: allergen.name,
        description: allergen.description,
        severity: allergen.severity,
        isActive: allergen.isActive,
        createdAt: allergen.createdAt,
        updatedAt: allergen.updatedAt,
      }));

      return sendSuccess(res, {
        allergens: formattedAllergens,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.rows.length,
        },
      });
    }

    // Get both standard and custom allergens
    const allergensQuery = `
      SELECT * FROM allergens 
      WHERE (tenantId = $1 OR (isStandard = true AND tenantId IS NULL))
      ORDER BY isStandard DESC, name ASC
    `;
    const result = await executeQuery(allergensQuery, [tenantId]);
    const allergens = result.rows;

    const formattedAllergens = allergens.map((allergen: any) => ({
      id: allergen.id,
      name: allergen.name,
      description: allergen.description,
      severity: allergen.severity,
      isStandard: allergen.isStandard,
      isActive: allergen.isActive,
      createdAt: allergen.createdAt,
      updatedAt: allergen.updatedAt,
    }));

    sendSuccess(res, { allergens: formattedAllergens });
  } catch (error) {
    logger.error("Get allergens error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch allergens");
  }
});

// GET /api/v1/allergens/:id - Get allergen by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    if (!id) {
      return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
    }

    // Check if it's a standard allergen or custom allergen for this tenant
    const allergenQuery = `
      SELECT * FROM allergens 
      WHERE id = $1 AND (tenantId = $2 OR (isStandard = true AND tenantId IS NULL))
    `;
    const result = await executeQuery(allergenQuery, [id, tenantId]);

    if (result.rows.length === 0) {
      throw new Error("not found");
    }

    const allergen = result.rows[0];

    const formattedAllergen = {
      id: allergen.id,
      name: allergen.name,
      description: allergen.description,
      severity: allergen.severity,
      isStandard: allergen.isStandard,
      isActive: allergen.isActive,
      createdAt: allergen.createdAt,
      updatedAt: allergen.updatedAt,
    };

    sendSuccess(res, { allergen: formattedAllergen });
  } catch (error) {
    logger.error("Get allergen error:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      sendError(res, "NOT_FOUND", "Allergen not found", 404);
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch allergen");
    }
  }
});

// POST /api/v1/allergens - Create new allergen
router.post(
  "/",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { name, description, severity = "MEDIUM" } = req.body;

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      // Validate severity
      const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      if (severity && !validSeverities.includes(severity)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Severity must be one of: LOW, MEDIUM, HIGH, CRITICAL",
          400
        );
      }

      const allergenData = {
        id: `alg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name,
        description: description || "",
        severity: severity || "MEDIUM",
        isStandard: false, // Custom allergen
        tenantId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // For custom allergens, check for duplicates within the tenant AND against standard allergens
      const checkQuery = `
      SELECT id, isStandard, tenantId FROM allergens 
      WHERE name = $1 AND (tenantId = $2 OR (isStandard = true AND tenantId IS NULL))
    `;
      const checkResult = await executeQuery(checkQuery, [name, tenantId]);

      if (checkResult.rows.length > 0) {
        const existing = checkResult.rows[0];
        if (existing.isStandard) {
          throw new Error("A standard allergen with this name already exists");
        } else {
          throw new Error(
            "A custom allergen with this name already exists for this tenant"
          );
        }
      }

      // Insert the custom allergen
      const fields = Object.keys(allergenData);
      const values = Object.values(allergenData);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      const fieldNames = fields.map((field) => field).join(", ");

      const insertQuery = `INSERT INTO allergens (${fieldNames}) VALUES (${placeholders}) RETURNING *`;
      const result = await executeQuery(insertQuery, values);
      const allergen = result.rows[0];

      const formattedAllergen = {
        id: allergen.id,
        name: allergen.name,
        description: allergen.description,
        severity: allergen.severity,
        isActive: allergen.isActive,
        createdAt: allergen.createdAt,
        updatedAt: allergen.updatedAt,
      };

      logger.info(`Allergen created: ${allergen.name}`);
      sendSuccess(
        res,
        { allergen: formattedAllergen },
        "Allergen created successfully",
        201
      );
    } catch (error) {
      logger.error("Create allergen error:", error);
      if (error instanceof Error && error.message.includes("already exists")) {
        sendError(
          res,
          "DUPLICATE_ERROR",
          "Allergen with this name already exists",
          409
        );
      } else {
        sendError(res, "CREATE_ERROR", "Failed to create allergen");
      }
    }
  }
);

// PUT /api/v1/allergens/:id - Update allergen
router.put(
  "/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { name, description, severity, isActive } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      // Validate severity
      const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      if (severity && !validSeverities.includes(severity)) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Severity must be one of: LOW, MEDIUM, HIGH, CRITICAL",
          400
        );
      }

      const updateData = {
        name,
        description: description || "",
        severity: severity || "MEDIUM",
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      };

      // Check if allergen exists and belongs to tenant (for custom allergens) or is standard
      const checkQuery = `
      SELECT * FROM allergens 
      WHERE id = $1 AND (tenantId = $2 OR (isStandard = true AND tenantId IS NULL))
    `;
      const checkResult = await executeQuery(checkQuery, [id, tenantId]);

      if (checkResult.rows.length === 0) {
        throw new Error("not found");
      }

      const existingAllergen = checkResult.rows[0];

      // Only allow updates to custom allergens (not standard allergens)
      if (existingAllergen.isStandard) {
        return sendError(
          res,
          "FORBIDDEN",
          "Cannot update standard allergens",
          403
        );
      }

      // Update the custom allergen
      const fields = Object.keys(updateData);
      const values = Object.values(updateData);
      const setClause = fields
        .map((field, index) => `${field} = $${index + 1}`)
        .join(", ");

      const updateQuery = `
      UPDATE allergens 
      SET ${setClause} 
      WHERE id = $${values.length + 1} AND tenantId = $${values.length + 2}
      RETURNING *
    `;
      const result = await executeQuery(updateQuery, [...values, id, tenantId]);

      if (result.rows.length === 0) {
        throw new Error("not found");
      }

      const allergen = result.rows[0];

      const formattedAllergen = {
        id: allergen.id,
        name: allergen.name,
        description: allergen.description,
        severity: allergen.severity,
        isActive: allergen.isActive,
        createdAt: allergen.createdAt,
        updatedAt: allergen.updatedAt,
      };

      logger.info(`Allergen updated: ${allergen.name}`);
      sendSuccess(
        res,
        { allergen: formattedAllergen },
        "Allergen updated successfully"
      );
    } catch (error) {
      logger.error("Update allergen error:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        sendError(res, "NOT_FOUND", "Allergen not found", 404);
      } else {
        sendError(res, "UPDATE_ERROR", "Failed to update allergen");
      }
    }
  }
);

// DELETE /api/v1/allergens/:id - Delete allergen
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

      // Check if allergen exists and belongs to tenant (for custom allergens) or is standard
      const checkQuery = `
      SELECT * FROM allergens 
      WHERE id = $1 AND (tenantId = $2 OR (isStandard = true AND tenantId IS NULL))
    `;
      const checkResult = await executeQuery(checkQuery, [id, tenantId]);

      if (checkResult.rows.length === 0) {
        throw new Error("not found");
      }

      const existingAllergen = checkResult.rows[0];

      // Only allow deletion of custom allergens (not standard allergens)
      if (existingAllergen.isStandard) {
        return sendError(
          res,
          "FORBIDDEN",
          "Cannot delete standard allergens",
          403
        );
      }

      // Check if allergen is used in any ingredients before deleting
      const usageCheck = await executeQuery(
        'SELECT COUNT(*) as count FROM "ingredientAllergens" WHERE "allergenId" = $1',
        [id]
      );

      if (usageCheck.rows[0].count > 0) {
        return sendError(
          res,
          "DEPENDENCY_ERROR",
          "Cannot delete allergen that is associated with ingredients",
          400
        );
      }

      // Delete the custom allergen
      const deleteQuery = `DELETE FROM allergens WHERE id = $1 AND tenantId = $2`;
      const deleteResult = await executeQuery(deleteQuery, [id, tenantId]);

      if (deleteResult.rowCount === 0) {
        throw new Error("not found");
      }

      logger.info(`Allergen deleted: ${id}`);
      sendSuccess(res, { success: true }, "Allergen deleted successfully");
    } catch (error) {
      logger.error("Delete allergen error:", error);
      if (error instanceof Error && error.message.includes("not found")) {
        sendError(res, "NOT_FOUND", "Allergen not found", 404);
      } else {
        sendError(res, "DELETE_ERROR", "Failed to delete allergen");
      }
    }
  }
);

export default router;
