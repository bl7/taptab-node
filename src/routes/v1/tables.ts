import { Router } from "express";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { TableController } from "../../controllers/TableController";

const router = Router();

// ==================== TABLES MANAGEMENT ====================

// GET /api/v1/tables - Get all tables
router.get("/", authenticateToken, TableController.getTables);

// POST /api/v1/tables - Create new table
router.post(
  "/",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  TableController.createTable
);

// GET /api/v1/tables/:tableId - Get table by ID
router.get("/:tableId", authenticateToken, TableController.getTable);

// PUT /api/v1/tables/:tableId - Update table
router.put(
  "/:tableId",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  TableController.updateTable
);

// DELETE /api/v1/tables/:tableId - Delete table
router.delete(
  "/:tableId",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  TableController.deleteTable
);

// GET /api/v1/tables/layout - Get table layout
router.get("/layout", authenticateToken, TableController.getTableLayout);

// GET /api/v1/tables/available - Get available tables
router.get("/available", authenticateToken, TableController.getAvailableTables);

// PATCH /api/v1/tables/:tableId/status - Update table status
router.patch(
  "/:tableId/status",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN", "WAITER", "CASHIER"]),
  TableController.updateTableStatus
);

export default router;
