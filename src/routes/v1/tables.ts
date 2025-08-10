import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId, getPublicTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import {
  findMany,
  createWithCheck,
  updateWithCheck,
  deleteWithCheck,
  executeQuery,
} from "../../utils/database";

const router = Router();

// ==================== TABLES MANAGEMENT ====================

// GET /api/tables - Get all tables (AUTHENTICATED)
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

    // Join with locations table to get location details
    const result = await executeQuery(
      `
      SELECT t.*, 
             l.id as location_id, l.name as location_name, l.description as location_description, l."isActive" as location_active
      FROM tables t
      LEFT JOIN locations l ON t."locationId" = l.id
      WHERE t."tenantId" = $1
      ORDER BY t."number" ASC
    `,
      [tenantId]
    );

    const formattedTables = result.rows.map((table: any) => ({
      id: table.id,
      number: table.number,
      capacity: table.capacity,
      status: table.status,
      location: table.location, // Legacy field for backward compatibility
      locationId: table.locationId,
      locationDetails: table.location_id
        ? {
            id: table.location_id,
            name: table.location_name,
            description: table.location_description,
            isActive: table.location_active,
          }
        : null,
      currentOrderId: table.currentOrderId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    }));

    sendSuccess(res, { tables: formattedTables });
  } catch (error) {
    logger.error("Get tables error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch tables");
  }
});

// POST /api/tables - Create new table
router.post(
  "/",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const {
        number,
        capacity,
        location,
        locationId,
        status = "available",
      } = req.body;

      if (!number) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Table number is required",
          400
        );
      }

      // Validate status
      const validStatuses = ["available", "occupied", "reserved", "cleaning"];
      if (!validStatuses.includes(status)) {
        return sendError(res, "VALIDATION_ERROR", "Invalid status value", 400);
      }

      // Validate locationId if provided
      if (locationId) {
        const locationResult = await executeQuery(
          'SELECT id FROM locations WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
          [locationId, tenantId]
        );

        if (locationResult.rows.length === 0) {
          return sendError(res, "VALIDATION_ERROR", "Invalid location ID", 400);
        }
      }

      const tableData = {
        id: `table_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        number,
        capacity: capacity || 4,
        status,
        location: location || "", // Keep for backward compatibility
        locationId: locationId || null,
        currentOrderId: null,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const table = await createWithCheck(
        "tables",
        tableData,
        "number",
        number,
        tenantId
      );

      // Get location details for response
      let locationDetails: any = null;
      if (table.locationId) {
        const locationResult = await executeQuery(
          "SELECT * FROM locations WHERE id = $1",
          [table.locationId]
        );

        if (locationResult.rows.length > 0) {
          const loc = locationResult.rows[0];
          locationDetails = {
            id: loc.id,
            name: loc.name,
            description: loc.description,
            isActive: loc.isActive,
          };
        }
      }

      const formattedTable = {
        id: table.id,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        location: table.location, // Legacy field
        locationId: table.locationId,
        locationDetails,
        currentOrderId: table.currentOrderId,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
      };

      logger.info(`Table created: ${table.number}`);
      sendSuccess(
        res,
        { table: formattedTable },
        "Table created successfully",
        201
      );
    } catch (error) {
      logger.error("Create table error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create table");
    }
  }
);

// PUT /api/tables/:id - Update table
router.put(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { number, capacity, status, location, locationId, currentOrderId } =
        req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Validate status if provided
      if (status) {
        const validStatuses = ["available", "occupied", "reserved", "cleaning"];
        if (!validStatuses.includes(status)) {
          return sendError(
            res,
            "VALIDATION_ERROR",
            "Invalid status value",
            400
          );
        }
      }

      const updateData: any = {
        updatedAt: new Date(),
      };

      // Validate locationId if provided
      if (locationId !== undefined && locationId !== null) {
        const locationResult = await executeQuery(
          'SELECT id FROM locations WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
          [locationId, tenantId]
        );

        if (locationResult.rows.length === 0) {
          return sendError(res, "VALIDATION_ERROR", "Invalid location ID", 400);
        }
      }

      if (number !== undefined) updateData.number = number;
      if (capacity !== undefined) updateData.capacity = capacity;
      if (status !== undefined) updateData.status = status;
      if (location !== undefined) updateData.location = location;
      if (locationId !== undefined) updateData.locationId = locationId;
      if (currentOrderId !== undefined)
        updateData.currentOrderId = currentOrderId;

      const table = await updateWithCheck("tables", id, updateData, tenantId);

      // Get location details for response
      let locationDetails: any = null;
      if (table.locationId) {
        const locationResult = await executeQuery(
          "SELECT * FROM locations WHERE id = $1",
          [table.locationId]
        );

        if (locationResult.rows.length > 0) {
          const loc = locationResult.rows[0];
          locationDetails = {
            id: loc.id,
            name: loc.name,
            description: loc.description,
            isActive: loc.isActive,
          };
        }
      }

      const formattedTable = {
        id: table.id,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        location: table.location, // Legacy field
        locationId: table.locationId,
        locationDetails,
        currentOrderId: table.currentOrderId,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
      };

      logger.info(`Table updated: ${table.number}`);
      sendSuccess(res, { table: formattedTable }, "Table updated successfully");
    } catch (error) {
      logger.error("Update table error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update table");
    }
  }
);

// DELETE /api/tables/:id - Delete table
router.delete(
  "/:id",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Check if table exists and delete
      await deleteWithCheck("tables", id, tenantId);

      logger.info(`Table deleted: ${id}`);
      sendSuccess(res, { success: true }, "Table deleted successfully");
    } catch (error) {
      logger.error("Delete table error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete table");
    }
  }
);

// PUT /api/tables/:id/status - Update table status
router.put(
  "/:id/status",
  authenticateToken,
  requireRole(["WAITER", "MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { status } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!status) {
        return sendError(res, "VALIDATION_ERROR", "Status is required", 400);
      }

      // Validate status
      const validStatuses = ["available", "occupied", "reserved", "cleaning"];
      if (!validStatuses.includes(status)) {
        return sendError(res, "VALIDATION_ERROR", "Invalid status value", 400);
      }

      const updateData = {
        status,
        updatedAt: new Date(),
      };

      const table = await updateWithCheck("tables", id, updateData, tenantId);

      const formattedTable = {
        id: table.id,
        number: table.number,
        capacity: table.capacity,
        status: table.status,
        location: table.location,
        currentOrderId: table.currentOrderId,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
      };

      logger.info(`Table status updated: ${table.number} - ${status}`);
      sendSuccess(
        res,
        { table: formattedTable },
        "Table status updated successfully"
      );
    } catch (error) {
      logger.error("Update table status error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update table status");
    }
  }
);

export default router;
