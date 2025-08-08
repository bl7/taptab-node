import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getPublicTenantId } from "../../middleware/tenant";
import { sendSuccess, sendError } from "../../utils/response";
import { findMany, executeQuery } from "../../utils/database";

const router = Router();

// ==================== PUBLIC TABLES (QR Ordering) ====================

// GET /api/v1/public/tables - Get all tables (PUBLIC - no auth required)
router.get("/", async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);

    const tables = await findMany(
      "tables",
      { tenantId: tenantId },
      '"number" ASC'
    );

    const formattedTables = tables.map((table: any) => ({
      id: table.id,
      number: table.number,
      capacity: table.capacity,
      status: table.status,
      location: table.location,
      currentOrderId: table.currentOrderId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    }));

    sendSuccess(res, { tables: formattedTables });
  } catch (error) {
    logger.error("Get public tables error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch tables");
    }
  }
});

// Test route to check if parameter routes work
router.get("/test", async (req: Request, res: Response) => {
  logger.info(`🔍 Test route hit`);
  sendSuccess(res, { message: "Test route works" });
});

// GET /api/v1/public/tables/:tableNumber - Get table info by number (PUBLIC - no auth required)
router.get("/:tableNumber", async (req: Request, res: Response) => {
  logger.info(`🔍 Route hit: /:tableNumber with params:`, req.params);
  try {
    const tenantId = await getPublicTenantId(req);
    const { tableNumber } = req.params;

    // Validate table number
    if (!tableNumber) {
      return sendError(
        res,
        "VALIDATION_ERROR",
        "Table number is required",
        400
      );
    }

    // Get table by number
    logger.info(
      `🔍 Looking for table number: ${tableNumber} in tenant: ${tenantId}`
    );
    const tableResult = await executeQuery(
      'SELECT * FROM tables WHERE number = $1 AND "tenantId" = $2',
      [tableNumber, tenantId]
    );
    logger.info(`🔍 Query result: ${tableResult.rows.length} rows found`);

    if (tableResult.rows.length === 0) {
      return sendError(res, "TABLE_NOT_FOUND", "Table not found", 404);
    }

    const table = tableResult.rows[0];

    // Return table info (including ID for order creation)
    const tableInfo = {
      id: table.id,
      number: table.number,
      name: table.name,
      capacity: table.capacity,
      isActive: table.isActive,
      tenantId: table.tenantId,
    };

    logger.info(`Table info retrieved: ${tableNumber} (ID: ${table.id})`);
    sendSuccess(res, { table: tableInfo });
  } catch (error) {
    logger.error("Get public table error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch table info");
    }
  }
});

export default router;
