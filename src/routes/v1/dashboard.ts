import { Router } from "express";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { DashboardController } from "../../controllers/DashboardController";

const router = Router();

// ==================== DASHBOARD ====================

// GET /api/v1/dashboard/overview - Get dashboard overview data
router.get(
  "/overview",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER", "CASHIER"]),
  DashboardController.getOverview
);

// GET /api/v1/dashboard/revenue-trend - Get revenue trend
router.get(
  "/revenue-trend",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getRevenueTrend
);

// GET /api/v1/dashboard/peak-hours - Get peak hours analytics
router.get(
  "/peak-hours",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getPeakHours
);

// GET /api/v1/dashboard/live-orders - Get live orders
router.get(
  "/live-orders",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER", "CASHIER"]),
  DashboardController.getLiveOrders
);

// GET /api/v1/dashboard/customer-analytics - Get customer analytics
router.get(
  "/customer-analytics",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getCustomerAnalytics
);

// GET /api/v1/dashboard/inventory-turnover - Get inventory analytics
router.get(
  "/inventory-turnover",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getInventoryTurnover
);

// GET /api/v1/dashboard/payment-methods - Get payment method analytics
router.get(
  "/payment-methods",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getPaymentMethodAnalytics
);

// GET /api/v1/dashboard/popular-combinations - Get popular combinations
router.get(
  "/popular-combinations",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getPopularCombinations
);

// GET /api/v1/dashboard/top-items - Get top selling items
router.get(
  "/top-items",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getTopItems
);

// GET /api/v1/dashboard/staff-performance - Get staff performance
router.get(
  "/staff-performance",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  DashboardController.getStaffPerformance
);

export default router;
