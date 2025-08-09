import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== LOCATIONS MANAGEMENT ====================

// GET /api/v1/locations - Get all locations
router.get(
  "/",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { includeInactive } = req.query;

      let query = `
      SELECT l.*, COUNT(t.id) as table_count
      FROM locations l
      LEFT JOIN tables t ON l.id = t."locationId"
      WHERE l."tenantId" = $1
    `;
      const values = [tenantId];

      if (!includeInactive) {
        query += ` AND l."isActive" = true`;
      }

      query += ` GROUP BY l.id, l.name, l.description, l."tenantId", l."isActive", l."createdAt", l."updatedAt"`;
      query += ` ORDER BY l.name ASC`;

      const result = await executeQuery(query, values);

      const formattedLocations = result.rows.map((location: any) => ({
        id: location.id,
        name: location.name,
        description: location.description,
        isActive: location.isActive,
        tableCount: parseInt(location.table_count),
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
      }));

      sendSuccess(res, { locations: formattedLocations });
    } catch (error) {
      logger.error("Get locations error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch locations");
    }
  }
);

// POST /api/v1/locations - Create new location
router.post(
  "/",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { name, description, isActive = true } = req.body;

      if (!name || name.trim().length === 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Location name is required",
          400
        );
      }

      // Check if location name already exists for this tenant
      const existingResult = await executeQuery(
        'SELECT id FROM locations WHERE "tenantId" = $1 AND name = $2',
        [tenantId, name.trim()]
      );

      if (existingResult.rows.length > 0) {
        return sendError(
          res,
          "DUPLICATE_ERROR",
          "Location with this name already exists",
          400
        );
      }

      const locationData = {
        id: `loc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: name.trim(),
        description: description?.trim() || "",
        tenantId,
        isActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executeQuery(
        `INSERT INTO locations (id, name, description, "tenantId", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          locationData.id,
          locationData.name,
          locationData.description,
          locationData.tenantId,
          locationData.isActive,
          locationData.createdAt,
          locationData.updatedAt,
        ]
      );

      const location = result.rows[0];

      const formattedLocation = {
        id: location.id,
        name: location.name,
        description: location.description,
        isActive: location.isActive,
        tableCount: 0,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
      };

      logger.info(`Location created: ${location.name} for tenant ${tenantId}`);
      sendSuccess(
        res,
        { location: formattedLocation },
        "Location created successfully",
        201
      );
    } catch (error) {
      logger.error("Create location error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create location");
    }
  }
);

// PUT /api/v1/locations/:id - Update location
router.put(
  "/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { name, description, isActive } = req.body;

      if (!id) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Location ID is required",
          400
        );
      }

      // Check if location exists and belongs to tenant
      const existingResult = await executeQuery(
        'SELECT * FROM locations WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Location not found", 404);
      }

      // Check if new name conflicts with existing location (if name is being changed)
      if (name && name.trim() !== existingResult.rows[0].name) {
        const duplicateResult = await executeQuery(
          'SELECT id FROM locations WHERE "tenantId" = $1 AND name = $2 AND id != $3',
          [tenantId, name.trim(), id]
        );

        if (duplicateResult.rows.length > 0) {
          return sendError(
            res,
            "DUPLICATE_ERROR",
            "Location with this name already exists",
            400
          );
        }
      }

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (name !== undefined && name.trim().length > 0)
        updateData.name = name.trim();
      if (description !== undefined)
        updateData.description = description?.trim() || "";
      if (isActive !== undefined) updateData.isActive = isActive;

      const updateFields = Object.keys(updateData);
      const updateValues = Object.values(updateData);
      const setClause = updateFields
        .map((field, index) => `"${field}" = $${index + 3}`)
        .join(", ");

      const result = await executeQuery(
        `UPDATE locations SET ${setClause} WHERE id = $1 AND "tenantId" = $2 RETURNING *`,
        [id, tenantId, ...updateValues]
      );

      // Get table count
      const tableCountResult = await executeQuery(
        'SELECT COUNT(*) as count FROM tables WHERE "locationId" = $1',
        [id]
      );

      const location = result.rows[0];
      const formattedLocation = {
        id: location.id,
        name: location.name,
        description: location.description,
        isActive: location.isActive,
        tableCount: parseInt(tableCountResult.rows[0].count),
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
      };

      logger.info(`Location updated: ${location.name} for tenant ${tenantId}`);
      sendSuccess(
        res,
        { location: formattedLocation },
        "Location updated successfully"
      );
    } catch (error) {
      logger.error("Update location error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update location");
    }
  }
);

// DELETE /api/v1/locations/:id - Delete location
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { force } = req.query;

      if (!id) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Location ID is required",
          400
        );
      }

      // Check if location exists and belongs to tenant
      const existingResult = await executeQuery(
        'SELECT * FROM locations WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Location not found", 404);
      }

      // Check if location has tables assigned
      const tablesResult = await executeQuery(
        'SELECT COUNT(*) as count FROM tables WHERE "locationId" = $1',
        [id]
      );

      const tableCount = parseInt(tablesResult.rows[0].count);

      if (tableCount > 0 && force !== "true") {
        return sendError(
          res,
          "LOCATION_IN_USE",
          `Cannot delete location. ${tableCount} table(s) are assigned to this location. Use force=true to reassign tables to null.`,
          400
        );
      }

      // If force delete, set tables' locationId to null
      if (tableCount > 0 && force === "true") {
        await executeQuery(
          'UPDATE tables SET "locationId" = NULL WHERE "locationId" = $1',
          [id]
        );
        logger.info(
          `Force delete: Unassigned ${tableCount} tables from location ${id}`
        );
      }

      // Delete the location
      await executeQuery(
        'DELETE FROM locations WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      logger.info(
        `Location deleted: ${existingResult.rows[0].name} for tenant ${tenantId}`
      );
      sendSuccess(res, { success: true }, "Location deleted successfully");
    } catch (error) {
      logger.error("Delete location error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete location");
    }
  }
);

export default router;
