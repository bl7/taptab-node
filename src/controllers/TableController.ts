import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { sendSuccess, sendError } from "../utils/response";
import { TableService } from "../services/TableService";
import { getTenantId } from "../middleware/tenant";

export class TableController {
  /**
   * Get all tables
   */
  static async getTables(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { isActive, status, location, tableType } = req.query;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const filters: any = {};
      if (isActive !== undefined) filters.isActive = isActive === "true";
      if (status) filters.status = status as string;
      if (location) filters.location = location as string;
      if (tableType) filters.tableType = tableType as string;

      const tables = await TableService.getTables(tenantId, filters);

      return sendSuccess(res, { tables }, "Tables retrieved successfully");
    } catch (error) {
      logger.error("TableController.getTables error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch tables");
    }
  }

  /**
   * Create a new table
   */
  static async createTable(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const tableData = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const table = await TableService.createTable({
        ...tableData,
        tenantId,
      });

      logger.info(`Table created via controller: ${table.id}`);
      return sendSuccess(res, { table }, "Table created successfully", 201);
    } catch (error) {
      logger.error("TableController.createTable error:", error);
      return sendError(res, "CREATE_ERROR", "Failed to create table");
    }
  }

  /**
   * Get table by ID
   */
  static async getTable(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { tableId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!tableId) {
        return sendError(res, "VALIDATION_ERROR", "Table ID is required", 400);
      }

      const table = await TableService.getTable(tableId, tenantId);

      return sendSuccess(res, { table }, "Table retrieved successfully");
    } catch (error) {
      logger.error("TableController.getTable error:", error);
      return sendError(res, "NOT_FOUND", "Table not found", 404);
    }
  }

  /**
   * Update table
   */
  static async updateTable(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { tableId } = req.params;
      const updates = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!tableId) {
        return sendError(res, "VALIDATION_ERROR", "Table ID is required", 400);
      }

      const updatedTable = await TableService.updateTable(
        tableId,
        tenantId,
        updates
      );

      return sendSuccess(
        res,
        { table: updatedTable },
        "Table updated successfully"
      );
    } catch (error) {
      logger.error("TableController.updateTable error:", error);
      return sendError(res, "UPDATE_ERROR", "Failed to update table");
    }
  }

  /**
   * Delete table
   */
  static async deleteTable(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { tableId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!tableId) {
        return sendError(res, "VALIDATION_ERROR", "Table ID is required", 400);
      }

      const result = await TableService.deleteTable(tableId, tenantId);

      return sendSuccess(res, result, "Table deleted successfully");
    } catch (error) {
      logger.error("TableController.deleteTable error:", error);
      return sendError(res, "DELETE_ERROR", "Failed to delete table");
    }
  }

  /**
   * Get table layout
   */
  static async getTableLayout(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const tableLayout = await TableService.getTableLayout(tenantId);

      return sendSuccess(
        res,
        { tableLayout },
        "Table layout retrieved successfully"
      );
    } catch (error) {
      logger.error("TableController.getTableLayout error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch table layout");
    }
  }

  /**
   * Get available tables
   */
  static async getAvailableTables(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { capacity } = req.query;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const capacityFilter = capacity
        ? parseInt(capacity as string)
        : undefined;
      const availableTables = await TableService.getAvailableTables(
        tenantId,
        capacityFilter
      );

      return sendSuccess(
        res,
        { tables: availableTables },
        "Available tables retrieved successfully"
      );
    } catch (error) {
      logger.error("TableController.getAvailableTables error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch available tables");
    }
  }

  /**
   * Update table status
   */
  static async updateTableStatus(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { tableId } = req.params;
      const { status } = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!tableId) {
        return sendError(res, "VALIDATION_ERROR", "Table ID is required", 400);
      }

      if (!status) {
        return sendError(res, "VALIDATION_ERROR", "Status is required", 400);
      }

      const updatedTable = await TableService.updateTableStatus(
        tableId,
        tenantId,
        status
      );

      return sendSuccess(
        res,
        { table: updatedTable },
        "Table status updated successfully"
      );
    } catch (error) {
      logger.error("TableController.updateTableStatus error:", error);
      return sendError(res, "UPDATE_ERROR", "Failed to update table status");
    }
  }
}
