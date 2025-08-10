import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== DASHBOARD ====================

// GET /api/dashboard/overview - Get dashboard overview data (TODAY ONLY)
router.get(
  "/overview",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER", "CASHIER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Dashboard shows TODAY'S data only
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ); // Start of today
      const todayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      ); // Start of tomorrow

      // Get total orders
      const totalOrdersQuery = `
        SELECT COUNT(*) as count
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" < $3
          AND status != 'cancelled'
      `;
      const totalOrdersResult = await executeQuery(totalOrdersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const totalOrders = parseInt(totalOrdersResult.rows[0].count);

      // Get yesterday's data for comparison
      const yesterdayStart = new Date(
        todayStart.getTime() - 24 * 60 * 60 * 1000
      );
      const yesterdayEnd = new Date(todayStart.getTime());

      const prevOrdersResult = await executeQuery(totalOrdersQuery, [
        tenantId,
        yesterdayStart,
        yesterdayEnd,
      ]);
      const prevOrders = parseInt(prevOrdersResult.rows[0].count);
      const orderGrowth =
        prevOrders > 0 ? ((totalOrders - prevOrders) / prevOrders) * 100 : 0;

      // Get active orders (today only)
      const activeOrdersQuery = `
      SELECT COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND status = 'active'
    `;
      const activeOrdersResult = await executeQuery(activeOrdersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const activeOrders = parseInt(activeOrdersResult.rows[0].count);

      // Get total revenue
      const totalRevenueQuery = `
      SELECT COALESCE(SUM("finalAmount"), 0) as total
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND status != 'cancelled'
    `;
      const totalRevenueResult = await executeQuery(totalRevenueQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const totalRevenue = parseFloat(totalRevenueResult.rows[0].total);

      const prevRevenueResult = await executeQuery(totalRevenueQuery, [
        tenantId,
        yesterdayStart,
        yesterdayEnd,
      ]);
      const prevRevenue = parseFloat(prevRevenueResult.rows[0].total);
      const revenueGrowth =
        prevRevenue > 0
          ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
          : 0;

      // Get average order value
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const prevAvgOrderValue = prevOrders > 0 ? prevRevenue / prevOrders : 0;
      const avgOrderGrowth =
        prevAvgOrderValue > 0
          ? ((avgOrderValue - prevAvgOrderValue) / prevAvgOrderValue) * 100
          : 0;

      // Get total customers (unique customers)
      const totalCustomersQuery = `
      SELECT COUNT(DISTINCT "customerPhone") as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND "customerPhone" IS NOT NULL
        AND status != 'cancelled'
    `;
      const totalCustomersResult = await executeQuery(totalCustomersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const totalCustomers = parseInt(totalCustomersResult.rows[0].count);

      // Get new customers today
      const newCustomersQuery = `
      SELECT COUNT(DISTINCT "customerPhone") as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND "customerPhone" IS NOT NULL
        AND status != 'cancelled'
    `;
      const newCustomersResult = await executeQuery(newCustomersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const newCustomers = parseInt(newCustomersResult.rows[0].count);

      // Get cancelled orders count (today)
      const cancelledOrdersQuery = `
      SELECT COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND status = 'cancelled'
    `;
      const cancelledOrdersResult = await executeQuery(cancelledOrdersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const cancelledOrders = parseInt(cancelledOrdersResult.rows[0].count);

      // Get payment method breakdown (today)
      const paymentMethodsQuery = `
      SELECT 
        COUNT(CASE WHEN "paymentMethod" = 'CASH' THEN 1 END) as cash_count,
        COUNT(CASE WHEN "paymentMethod" = 'CARD' THEN 1 END) as card_count,
        COUNT(CASE WHEN "paymentMethod" = 'QR' THEN 1 END) as qr_count,
        COUNT(CASE WHEN "paymentMethod" = 'STRIPE' THEN 1 END) as stripe_count,
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'CASH' THEN "finalAmount" ELSE 0 END), 0) as cash_revenue,
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'CARD' THEN "finalAmount" ELSE 0 END), 0) as card_revenue,
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'QR' THEN "finalAmount" ELSE 0 END), 0) as qr_revenue,
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'STRIPE' THEN "finalAmount" ELSE 0 END), 0) as stripe_revenue
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" < $3
        AND "paymentStatus" IN ('paid', 'PAID')
    `;
      const paymentMethodsResult = await executeQuery(paymentMethodsQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const paymentMethods = paymentMethodsResult.rows[0];

      sendSuccess(res, {
        summary: {
          totalOrders: {
            value: totalOrders,
            growth: orderGrowth,
            period: "Today",
          },
          activeOrders: {
            value: activeOrders,
            status: "Currently processing",
          },
          cancelledOrders: {
            value: cancelledOrders,
            status: "Cancelled today",
          },
          totalRevenue: {
            value: totalRevenue,
            growth: revenueGrowth,
            period: "Today",
          },
          totalCustomers: {
            value: totalCustomers,
            newToday: newCustomers,
          },
          avgOrderValue: {
            value: avgOrderValue,
            growth: avgOrderGrowth,
          },
          paymentMethods: {
            cash: {
              count: parseInt(paymentMethods.cash_count),
              revenue: parseFloat(paymentMethods.cash_revenue),
            },
            card: {
              count: parseInt(paymentMethods.card_count),
              revenue: parseFloat(paymentMethods.card_revenue),
            },
            qr: {
              count: parseInt(paymentMethods.qr_count),
              revenue: parseFloat(paymentMethods.qr_revenue),
            },
            stripe: {
              count: parseInt(paymentMethods.stripe_count),
              revenue: parseFloat(paymentMethods.stripe_revenue),
            },
          },
        },
      });
    } catch (error) {
      logger.error("Get dashboard overview error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch dashboard overview");
    }
  }
);

// GET /api/dashboard/live-orders - Get live orders
router.get(
  "/live-orders",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER", "WAITER", "CASHIER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Dashboard shows TODAY'S active orders only
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ); // Start of today
      const todayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      ); // Start of tomorrow

      // Get live orders (orders that should be visible on tables)
      const liveOrdersQuery = `
        SELECT o.*, 
               oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
               mi.name as menu_item_name,
               u."firstName" as waiter_first_name, u."lastName" as waiter_last_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        LEFT JOIN users u ON o."createdById" = u.id
        WHERE o."tenantId" = $1 
          AND o."createdAt" >= $2 
          AND o."createdAt" < $3
          AND o.status = 'active'
          AND (
            o."orderSource" = 'QR_ORDERING' 
            OR (o."orderSource" IN ('WAITER', 'CASHIER', 'WAITER_ORDERING') AND o."paymentStatus" IN ('pending', 'PENDING'))
          )
        ORDER BY o."createdAt" ASC
      `;
      const result = await executeQuery(liveOrdersQuery, [
        tenantId,
        todayStart,
        todayEnd,
      ]);
      const rows = result.rows;

      // Group orders and their items
      const ordersMap = new Map();
      rows.forEach((row: any) => {
        if (!ordersMap.has(row.id)) {
          const timeDiff = Math.floor(
            (Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60)
          );

          ordersMap.set(row.id, {
            id: row.id,
            tableNumber: row.tableNumber,
            items: [],
            total: parseFloat(row.finalAmount.toString()),
            status: row.status.toLowerCase(),
            paymentStatus: row.paymentStatus,
            orderSource: row.orderSource,
            waiterName:
              row.createdByUserName ||
              (row.waiter_first_name && row.waiter_last_name
                ? `${row.waiter_first_name} ${row.waiter_last_name}`
                : "Unknown"),
            createdAt: row.createdAt,
            timeAgo: `${timeDiff} min ago`,
            customerName: row.customerName,
            specialInstructions: row.specialInstructions,
          });
        }

        if (row.menuItemId) {
          ordersMap.get(row.id).items.push({
            menuItemName: row.menu_item_name,
            quantity: row.quantity,
            price: parseFloat(row.unitPrice.toString()),
            notes: row.notes,
          });
        }
      });

      const liveOrders = Array.from(ordersMap.values());

      sendSuccess(res, { orders: liveOrders });
    } catch (error) {
      logger.error("Get live orders error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch live orders");
    }
  }
);

// GET /api/dashboard/revenue-trend - Get revenue trend data (LAST 7 DAYS)
router.get(
  "/revenue-trend",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Dashboard shows last 7 days trend
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      const revenueQuery = `
        SELECT 
          DATE("createdAt") as date,
          COALESCE(SUM("finalAmount"), 0) as daily_revenue,
          COUNT(*) as daily_orders
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" <= $3
          AND status != 'cancelled'
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `;
      const result = await executeQuery(revenueQuery, [
        tenantId,
        startDate,
        endDate,
      ]);
      const rows = result.rows;

      // Calculate growth percentage
      const totalRevenue = rows.reduce(
        (sum: number, row: any) => sum + parseFloat(row.daily_revenue),
        0
      );
      const prevPeriodStart = new Date(
        startDate.getTime() - (endDate.getTime() - startDate.getTime())
      );
      const prevPeriodEnd = new Date(startDate.getTime());

      const prevRevenueResult = await executeQuery(revenueQuery, [
        tenantId,
        prevPeriodStart,
        prevPeriodEnd,
      ]);
      const prevRevenue = prevRevenueResult.rows.reduce(
        (sum: number, row: any) => sum + parseFloat(row.daily_revenue),
        0
      );
      const growth =
        prevRevenue > 0
          ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
          : 0;

      // Format daily data
      const dailyData = rows.map((row: any) => ({
        date: row.date,
        revenue: parseFloat(row.daily_revenue),
        orders: parseInt(row.daily_orders),
      }));

      sendSuccess(res, {
        growth,
        dailyData,
        totalRevenue,
      });
    } catch (error) {
      logger.error("Get revenue trend error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch revenue trend");
    }
  }
);

// GET /api/dashboard/peak-hours - Get peak hours analytics (LAST 30 DAYS)
router.get(
  "/peak-hours",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Dashboard shows last 30 days peak hours
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get peak hours by day of week for better analysis
      const peakHoursQuery = `
      SELECT 
        EXTRACT(DOW FROM "createdAt") as day_of_week,
        EXTRACT(HOUR FROM "createdAt") as hour,
        COUNT(*) as order_count,
        COALESCE(SUM("finalAmount"), 0) as revenue
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'cancelled'
      GROUP BY EXTRACT(DOW FROM "createdAt"), EXTRACT(HOUR FROM "createdAt")
      ORDER BY day_of_week ASC, hour ASC
    `;
      const result = await executeQuery(peakHoursQuery, [
        tenantId,
        startDate,
        endDate,
      ]);
      const rows = result.rows;

      // Group by day of week for better analysis
      const daysOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const peakHoursByDay: any = {};

      // Initialize structure for each day
      daysOfWeek.forEach((day, index) => {
        peakHoursByDay[day] = {
          dayName: day,
          dayIndex: index,
          hours: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            orderCount: 0,
            revenue: 0,
            activity: 0,
          })),
        };
      });

      // Fill in the data
      rows.forEach((row: any) => {
        const dayIndex = parseInt(row.day_of_week);
        const hour = parseInt(row.hour);
        const dayName = daysOfWeek[dayIndex];

        if (peakHoursByDay[dayName]) {
          peakHoursByDay[dayName].hours[hour] = {
            hour,
            orderCount: parseInt(row.order_count),
            revenue: parseFloat(row.revenue),
            activity: 0, // Will calculate below
          };
        }
      });

      // Calculate activity percentage for each day
      Object.values(peakHoursByDay).forEach((dayData: any) => {
        const maxOrders = Math.max(
          ...dayData.hours.map((h: any) => h.orderCount)
        );
        dayData.hours.forEach((hourData: any) => {
          hourData.activity =
            maxOrders > 0 ? (hourData.orderCount / maxOrders) * 100 : 0;
        });
      });

      // Keep the same response format but with enhanced data
      const peakHours = Object.values(peakHoursByDay).flatMap((dayData: any) =>
        dayData.hours.map((hourData: any) => ({
          hour: hourData.hour,
          orderCount: hourData.orderCount,
          revenue: hourData.revenue,
          activity: hourData.activity,
          dayName: dayData.dayName,
          dayIndex: dayData.dayIndex,
        }))
      );

      sendSuccess(res, { peakHours });
    } catch (error) {
      logger.error("Get peak hours error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch peak hours");
    }
  }
);

// GET /api/dashboard/top-items - Get top selling items (LAST 30 DAYS)
router.get(
  "/top-items",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { limit = 10 } = req.query;

      // Dashboard shows last 30 days top items
      const now = new Date();
      const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const topItemsQuery = `
      SELECT 
        mi.id as menu_item_id,
        mi.name as menu_item_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi."totalPrice") as total_revenue,
        COUNT(DISTINCT o.id) as order_count
      FROM orders o
      JOIN "orderItems" oi ON o.id = oi."orderId"
      JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1 
        AND o."createdAt" >= $2 
        AND o."createdAt" <= $3
        AND o.status != 'cancelled'
      GROUP BY mi.id, mi.name
      ORDER BY total_revenue DESC
      LIMIT $4
    `;
      const result = await executeQuery(topItemsQuery, [
        tenantId,
        startDate,
        now,
        parseInt(limit as string),
      ]);
      const rows = result.rows;

      // Calculate total revenue for percentage
      const totalRevenue = rows.reduce(
        (sum: number, row: any) => sum + parseFloat(row.total_revenue),
        0
      );

      const topItems = rows.map((row: any, index: number) => ({
        rank: index + 1,
        menuItemId: row.menu_item_id,
        name: row.menu_item_name,
        quantity: parseInt(row.total_quantity),
        revenue: parseFloat(row.total_revenue),
        orderCount: parseInt(row.order_count),
        percentage:
          totalRevenue > 0
            ? (parseFloat(row.total_revenue) / totalRevenue) * 100
            : 0,
      }));

      sendSuccess(res, { topItems, totalRevenue });
    } catch (error) {
      logger.error("Get top items error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch top items");
    }
  }
);

// GET /api/dashboard/staff-performance - Get staff performance (LAST 30 DAYS)
router.get(
  "/staff-performance",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      // Dashboard shows last 30 days staff performance
      const now = new Date();
      const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const staffQuery = `
      SELECT 
        u.id as user_id,
        u."firstName",
        u."lastName",
        COUNT(o.id) as order_count,
        COALESCE(SUM(o."finalAmount"), 0) as total_revenue,
        AVG(o."finalAmount") as avg_order_value
      FROM users u
      LEFT JOIN orders o ON u.id = o."createdById" 
        AND o."tenantId" = $1 
        AND o."createdAt" >= $2 
        AND o."createdAt" <= $3
        AND o.status != 'cancelled'
      WHERE u."tenantId" = $1 
        AND u.role IN ('WAITER', 'CASHIER')
        AND u."isActive" = true
      GROUP BY u.id, u."firstName", u."lastName"
      ORDER BY total_revenue DESC
    `;
      const result = await executeQuery(staffQuery, [tenantId, startDate, now]);
      const rows = result.rows;

      const staffPerformance = rows.map((row: any) => ({
        userId: row.user_id,
        name: `${row.firstName} ${row.lastName}`,
        orderCount: parseInt(row.order_count),
        totalRevenue: parseFloat(row.total_revenue),
        avgOrderValue: parseFloat(row.avg_order_value),
        rating: 4.5 + Math.random() * 0.5, // Mock rating for now
      }));

      sendSuccess(res, { staffPerformance });
    } catch (error) {
      logger.error("Get staff performance error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch staff performance");
    }
  }
);

// GET /api/dashboard/popular-combinations - Get popular item combinations
router.get(
  "/popular-combinations",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { limit = 5 } = req.query;

      const combinationsQuery = `
      WITH order_combinations AS (
        SELECT 
          o.id,
          STRING_AGG(mi.name, ' + ' ORDER BY mi.name) as combination,
          COUNT(DISTINCT oi."menuItemId") as item_count,
          SUM(oi."totalPrice") as order_revenue
        FROM orders o
        JOIN "orderItems" oi ON o.id = oi."orderId"
        JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE o."tenantId" = $1 
          AND o.status != 'cancelled'
        GROUP BY o.id
        HAVING COUNT(DISTINCT oi."menuItemId") = 2
      )
      SELECT 
        combination,
        COUNT(*) as combination_count,
        SUM(order_revenue) as total_revenue
      FROM order_combinations
      GROUP BY combination
      ORDER BY combination_count DESC, total_revenue DESC
      LIMIT $2
    `;
      const result = await executeQuery(combinationsQuery, [
        tenantId,
        parseInt(limit as string),
      ]);
      const rows = result.rows;

      const combinations = rows.map((row: any) => ({
        combination: row.combination,
        orderCount: parseInt(row.combination_count), // How many times this combination was ordered
        revenue: parseFloat(row.total_revenue),
      }));

      sendSuccess(res, { combinations });
    } catch (error) {
      logger.error("Get popular combinations error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch popular combinations");
    }
  }
);

export default router;
