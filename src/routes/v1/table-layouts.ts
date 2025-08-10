import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== TABLE LAYOUTS MANAGEMENT ====================

// GET /api/v1/table-layouts - Get all table layouts
router.get(
  "/",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { locationId, includeInactive } = req.query;

      let query = `
        SELECT tl.*, 
               l.name as location_name, l.description as location_description,
               u."firstName" as creator_first_name, u."lastName" as creator_last_name
        FROM table_layouts tl
        LEFT JOIN locations l ON tl."locationId" = l.id
        LEFT JOIN users u ON tl."createdByUserId" = u.id
        WHERE tl."tenantId" = $1
      `;
      const values = [tenantId];

      if (locationId) {
        query += ` AND tl."locationId" = $${values.length + 1}`;
        values.push(locationId as string);
      }

      if (!includeInactive) {
        query += ` AND tl."isActive" = true`;
      }

      query += ` ORDER BY tl."locationId", tl."isDefault" DESC, tl.name ASC`;

      const result = await executeQuery(query, values);

      const formattedLayouts = result.rows.map((layout: any) => ({
        id: layout.id,
        name: layout.name,
        description: layout.description,
        locationId: layout.locationId,
        locationDetails: layout.location_name
          ? {
              name: layout.location_name,
              description: layout.location_description,
            }
          : null,
        layoutJson: layout.layout_json,
        isActive: layout.isActive,
        isDefault: layout.isDefault,
        createdByUserId: layout.createdByUserId,
        createdBy:
          layout.creator_first_name && layout.creator_last_name
            ? `${layout.creator_first_name} ${layout.creator_last_name}`
            : layout.createdByUserId || "Unknown",
        createdAt: layout.createdAt,
        updatedAt: layout.updatedAt,
      }));

      sendSuccess(res, { layouts: formattedLayouts });
    } catch (error) {
      logger.error("Get table layouts error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch table layouts");
    }
  }
);

// GET /api/v1/table-layouts/:id - Get specific table layout
router.get(
  "/:id",
  authenticateToken,
  requireRole(["WAITER", "CASHIER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "Layout ID is required", 400);
      }

      const result = await executeQuery(
        `SELECT tl.*, 
                l.name as location_name, l.description as location_description,
                u."firstName" as creator_first_name, u."lastName" as creator_last_name
         FROM table_layouts tl
         LEFT JOIN locations l ON tl."locationId" = l.id
         LEFT JOIN users u ON tl."createdByUserId" = u.id
         WHERE tl.id = $1 AND tl."tenantId" = $2`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Table layout not found", 404);
      }

      const layout = result.rows[0];
      const formattedLayout = {
        id: layout.id,
        name: layout.name,
        description: layout.description,
        locationId: layout.locationId,
        locationDetails: layout.location_name
          ? {
              name: layout.location_name,
              description: layout.location_description,
            }
          : null,
        layoutJson: layout.layout_json,
        isActive: layout.isActive,
        isDefault: layout.isDefault,
        createdByUserId: layout.createdByUserId,
        createdBy:
          layout.creator_first_name && layout.creator_last_name
            ? `${layout.creator_first_name} ${layout.creator_last_name}`
            : layout.createdByUserId || "Unknown",
        createdAt: layout.createdAt,
        updatedAt: layout.updatedAt,
      };

      sendSuccess(res, { layout: formattedLayout });
    } catch (error) {
      logger.error("Get table layout error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch table layout");
    }
  }
);

// POST /api/v1/table-layouts - Create new table layout
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
        locationId,
        layoutJson,
        isActive = true,
        isDefault = false,
      } = req.body;

      if (!name || name.trim().length === 0) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Layout name is required",
          400
        );
      }

      if (!locationId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Location ID is required",
          400
        );
      }

      if (!layoutJson || typeof layoutJson !== "object") {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Valid layout JSON is required",
          400
        );
      }

      // Validate locationId exists and belongs to tenant
      const locationResult = await executeQuery(
        'SELECT id FROM locations WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
        [locationId, tenantId]
      );

      if (locationResult.rows.length === 0) {
        return sendError(res, "VALIDATION_ERROR", "Invalid location ID", 400);
      }

      // Check if layout name already exists for this location
      const existingResult = await executeQuery(
        'SELECT id FROM table_layouts WHERE "tenantId" = $1 AND "locationId" = $2 AND name = $3',
        [tenantId, locationId, name.trim()]
      );

      if (existingResult.rows.length > 0) {
        return sendError(
          res,
          "DUPLICATE_ERROR",
          "Layout with this name already exists for this location",
          400
        );
      }

      // If setting as default, unset other defaults for this location
      if (isDefault) {
        await executeQuery(
          'UPDATE table_layouts SET "isDefault" = false WHERE "tenantId" = $1 AND "locationId" = $2',
          [tenantId, locationId]
        );
      }

      const layoutData = {
        id: `layout_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: name.trim(),
        description: description?.trim() || "",
        locationId,
        tenantId,
        layout_json: JSON.stringify(layoutJson),
        isActive,
        isDefault,
        createdByUserId: user?.id || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executeQuery(
        `INSERT INTO table_layouts (
          id, name, description, "locationId", "tenantId", layout_json, 
          "isActive", "isDefault", "createdByUserId", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          layoutData.id,
          layoutData.name,
          layoutData.description,
          layoutData.locationId,
          layoutData.tenantId,
          layoutData.layout_json,
          layoutData.isActive,
          layoutData.isDefault,
          layoutData.createdByUserId,
          layoutData.createdAt,
          layoutData.updatedAt,
        ]
      );

      const layout = result.rows[0];

      // Get location details for response
      const locationDetailsResult = await executeQuery(
        "SELECT name, description FROM locations WHERE id = $1",
        [locationId]
      );

      const formattedLayout = {
        id: layout.id,
        name: layout.name,
        description: layout.description,
        locationId: layout.locationId,
        locationDetails:
          locationDetailsResult.rows.length > 0
            ? {
                name: locationDetailsResult.rows[0].name,
                description: locationDetailsResult.rows[0].description,
              }
            : null,
        layoutJson: layout.layout_json,
        isActive: layout.isActive,
        isDefault: layout.isDefault,
        createdByUserId: layout.createdByUserId,
        createdBy:
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown",
        createdAt: layout.createdAt,
        updatedAt: layout.updatedAt,
      };

      logger.info(
        `Table layout created: ${layout.name} for location ${locationId} by user ${user?.id}`
      );
      sendSuccess(
        res,
        { layout: formattedLayout },
        "Table layout created successfully",
        201
      );
    } catch (error) {
      logger.error("Create table layout error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create table layout");
    }
  }
);

// PUT /api/v1/table-layouts/:id - Update table layout
router.put(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const user = (req as any).user;
      const { id } = req.params;
      const { name, description, layoutJson, isActive, isDefault } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "Layout ID is required", 400);
      }

      // Check if layout exists and belongs to tenant
      const existingResult = await executeQuery(
        'SELECT * FROM table_layouts WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Table layout not found", 404);
      }

      const existingLayout = existingResult.rows[0];

      // Check if new name conflicts with existing layout (if name is being changed)
      if (name && name.trim() !== existingLayout.name) {
        const duplicateResult = await executeQuery(
          'SELECT id FROM table_layouts WHERE "tenantId" = $1 AND "locationId" = $2 AND name = $3 AND id != $4',
          [tenantId, existingLayout.locationId, name.trim(), id]
        );

        if (duplicateResult.rows.length > 0) {
          return sendError(
            res,
            "DUPLICATE_ERROR",
            "Layout with this name already exists for this location",
            400
          );
        }
      }

      // If setting as default, unset other defaults for this location
      if (isDefault === true && !existingLayout.isDefault) {
        await executeQuery(
          'UPDATE table_layouts SET "isDefault" = false WHERE "tenantId" = $1 AND "locationId" = $2 AND id != $3',
          [tenantId, existingLayout.locationId, id]
        );
      }

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (name !== undefined && name.trim().length > 0)
        updateData.name = name.trim();
      if (description !== undefined)
        updateData.description = description?.trim() || "";
      if (layoutJson !== undefined) {
        if (typeof layoutJson !== "object") {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Valid layout JSON is required",
            400
          );
        }
        updateData.layout_json = JSON.stringify(layoutJson);
      }
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isDefault !== undefined) updateData.isDefault = isDefault;

      const updateFields = Object.keys(updateData);
      const updateValues = Object.values(updateData);
      const setClause = updateFields
        .map((field, index) => `"${field}" = $${index + 3}`)
        .join(", ");

      const result = await executeQuery(
        `UPDATE table_layouts SET ${setClause} WHERE id = $1 AND "tenantId" = $2 RETURNING *`,
        [id, tenantId, ...updateValues]
      );

      // Get location details for response
      const locationDetailsResult = await executeQuery(
        "SELECT name, description FROM locations WHERE id = $1",
        [existingLayout.locationId]
      );

      const layout = result.rows[0];
      const formattedLayout = {
        id: layout.id,
        name: layout.name,
        description: layout.description,
        locationId: layout.locationId,
        locationDetails:
          locationDetailsResult.rows.length > 0
            ? {
                name: locationDetailsResult.rows[0].name,
                description: locationDetailsResult.rows[0].description,
              }
            : null,
        layoutJson: layout.layout_json,
        isActive: layout.isActive,
        isDefault: layout.isDefault,
        createdByUserId: layout.createdByUserId,
        createdBy:
          user?.firstName && user?.lastName
            ? `${user.firstName} ${user.lastName}`
            : user?.id || "Unknown",
        createdAt: layout.createdAt,
        updatedAt: layout.updatedAt,
      };

      logger.info(
        `Table layout updated: ${layout.name} for location ${layout.locationId} by user ${user?.id}`
      );
      sendSuccess(
        res,
        { layout: formattedLayout },
        "Table layout updated successfully"
      );
    } catch (error) {
      logger.error("Update table layout error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update table layout");
    }
  }
);

// DELETE /api/v1/table-layouts/:id - Delete table layout
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const user = (req as any).user;
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "Layout ID is required", 400);
      }

      // Check if layout exists and belongs to tenant
      const existingResult = await executeQuery(
        'SELECT * FROM table_layouts WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      if (existingResult.rows.length === 0) {
        return sendError(res, "NOT_FOUND", "Table layout not found", 404);
      }

      const existingLayout = existingResult.rows[0];

      // Prevent deletion of default layout if it's the only one for the location
      if (existingLayout.isDefault) {
        const layoutCountResult = await executeQuery(
          'SELECT COUNT(*) as count FROM table_layouts WHERE "tenantId" = $1 AND "locationId" = $2 AND "isActive" = true',
          [tenantId, existingLayout.locationId]
        );

        const layoutCount = parseInt(layoutCountResult.rows[0].count);

        if (layoutCount === 1) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Cannot delete the only active layout for this location. Create another layout first or set another layout as default.",
            400
          );
        }

        // If deleting default layout, set another one as default
        await executeQuery(
          `UPDATE table_layouts 
           SET "isDefault" = true 
           WHERE "tenantId" = $1 AND "locationId" = $2 AND "isActive" = true AND id != $3 
           ORDER BY "createdAt" ASC 
           LIMIT 1`,
          [tenantId, existingLayout.locationId, id]
        );
      }

      // Delete the layout
      await executeQuery(
        'DELETE FROM table_layouts WHERE id = $1 AND "tenantId" = $2',
        [id, tenantId]
      );

      logger.info(
        `Table layout deleted: ${existingLayout.name} for location ${existingLayout.locationId} by user ${user?.id}`
      );
      sendSuccess(res, { success: true }, "Table layout deleted successfully");
    } catch (error) {
      logger.error("Delete table layout error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete table layout");
    }
  }
);

// PUT /api/v1/table-layouts/:id/set-default - Set layout as default for location
router.put(
  "/:id/set-default",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const user = (req as any).user;
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "Layout ID is required", 400);
      }

      // Check if layout exists and belongs to tenant
      const existingResult = await executeQuery(
        'SELECT * FROM table_layouts WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
        [id, tenantId]
      );

      if (existingResult.rows.length === 0) {
        return sendError(
          res,
          "NOT_FOUND",
          "Table layout not found or inactive",
          404
        );
      }

      const layout = existingResult.rows[0];

      if (layout.isDefault) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Layout is already set as default",
          400
        );
      }

      // Unset current default for this location
      await executeQuery(
        'UPDATE table_layouts SET "isDefault" = false WHERE "tenantId" = $1 AND "locationId" = $2',
        [tenantId, layout.locationId]
      );

      // Set this layout as default
      await executeQuery(
        'UPDATE table_layouts SET "isDefault" = true, "updatedAt" = $1 WHERE id = $2 AND "tenantId" = $3',
        [new Date(), id, tenantId]
      );

      logger.info(
        `Table layout set as default: ${layout.name} for location ${layout.locationId} by user ${user?.id}`
      );
      sendSuccess(
        res,
        { success: true },
        "Table layout set as default successfully"
      );
    } catch (error) {
      logger.error("Set default table layout error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to set table layout as default");
    }
  }
);

export default router;
