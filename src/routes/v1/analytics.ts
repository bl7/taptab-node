import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// ==================== ANALYTICS ====================

// GET /api/analytics/sales - Get sales analytics
router.get(
  "/sales",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { startDate, endDate } = req.query;

      // Parse dates
      const start = startDate
        ? new Date(startDate as string)
        : new Date(new Date().setDate(new Date().getDate() - 30));
      const end = endDate ? new Date(endDate as string) : new Date();

      // Get total orders count
      const totalOrdersQuery = `
        SELECT COUNT(*) as count
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" <= $3
          AND status != 'cancelled'
      `;
      const totalOrdersResult = await executeQuery(totalOrdersQuery, [
        tenantId,
        start,
        end,
      ]);
      const totalOrders = parseInt(totalOrdersResult.rows[0].count);

      // Get total sales
      const totalSalesQuery = `
        SELECT COALESCE(SUM("finalAmount"), 0) as total
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" <= $3
          AND status != 'cancelled'
      `;
      const totalSalesResult = await executeQuery(totalSalesQuery, [
        tenantId,
        start,
        end,
      ]);
      const totalSales = parseFloat(totalSalesResult.rows[0].total);

      // Get order items for top items analysis
      const orderItemsQuery = `
        SELECT oi."menuItemId", oi.quantity, oi."totalPrice", mi.name as menu_item_name
        FROM orders o
        LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
        LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE o."tenantId" = $1 
          AND o."createdAt" >= $2 
          AND o."createdAt" <= $3
          AND o.status != 'cancelled'
      `;
      const orderItemsResult = await executeQuery(orderItemsQuery, [
        tenantId,
        start,
        end,
      ]);
      const orderItems = orderItemsResult.rows;
      const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

      // Calculate top items
      const itemSales: {
        [key: string]: {
          menuItemId: string;
          name: string;
          quantity: number;
          revenue: number;
        };
      } = {};

      orderItems.forEach((item: any) => {
        if (item.menuItemId && item.menu_item_name) {
          const itemId = item.menuItemId;
          const itemName = item.menu_item_name;
          const quantity = item.quantity || 0;
          const revenue = parseFloat(item.totalPrice?.toString() || "0");

          if (itemSales[itemId]) {
            itemSales[itemId].quantity += quantity;
            itemSales[itemId].revenue += revenue;
          } else {
            itemSales[itemId] = {
              menuItemId: itemId,
              name: itemName,
              quantity,
              revenue,
            };
          }
        }
      });

      const topItems = Object.values(itemSales)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Calculate daily sales
      const dailySalesQuery = `
        SELECT 
          DATE("createdAt") as date,
          COUNT(*) as daily_orders,
          COALESCE(SUM("finalAmount"), 0) as daily_sales
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" <= $3
          AND status != 'cancelled'
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `;
      const dailySalesResult = await executeQuery(dailySalesQuery, [
        tenantId,
        start,
        end,
      ]);
      const dailySalesArray = dailySalesResult.rows.map((row: any) => ({
        date: row.date,
        sales: parseFloat(row.daily_sales),
        orders: parseInt(row.daily_orders),
      }));

      sendSuccess(res, {
        totalSales,
        totalOrders,
        averageOrderValue,
        topItems,
        dailySales: dailySalesArray,
      });
    } catch (error) {
      logger.error("Get sales analytics error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch sales analytics");
    }
  }
);

// GET /api/analytics/orders - Get order analytics
router.get(
  "/orders",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { status, tableId, startDate, endDate } = req.query;

      // Parse dates
      const start = startDate
        ? new Date(startDate as string)
        : new Date(new Date().setDate(new Date().getDate() - 30));
      const end = endDate ? new Date(endDate as string) : new Date();

      let ordersQuery = `
      SELECT status, COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
    `;
      const queryParams: any[] = [tenantId, start, end];

      if (status) {
        ordersQuery += ` AND status = $${queryParams.length + 1}`;
        queryParams.push(status);
      }
      if (tableId) {
        ordersQuery += ` AND "tableNumber" = $${queryParams.length + 1}`;
        queryParams.push(tableId);
      }

      ordersQuery += ` GROUP BY status`;

      const ordersResult = await executeQuery(ordersQuery, queryParams);
      const orders = ordersResult.rows;

      // Count orders by status
      const statusCounts: { [key: string]: number } = {};
      orders.forEach((row: any) => {
        statusCounts[row.status.toLowerCase()] = parseInt(row.count);
      });

      const paidOrders = statusCounts.paid || 0;
      const cancelledOrders = statusCounts.cancelled || 0;

      sendSuccess(res, {
        paidOrders,
        cancelledOrders,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      });
    } catch (error) {
      logger.error("Get order analytics error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch order analytics");
    }
  }
);

// GET /api/analytics/comprehensive - Get comprehensive analytics with date range
router.get(
  "/comprehensive",
  authenticateToken,
  requireRole(["MANAGER", "TENANT_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { startDate, endDate, period = "custom" } = req.query;

      // Parse dates based on period or custom dates
      let start: Date;
      let end = new Date();

      if (startDate && endDate) {
        start = new Date(startDate as string);
        end = new Date(endDate as string);
      } else {
        // Default periods
        switch (period) {
          case "today":
            start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            break;
          case "yesterday":
            start = new Date(
              end.getFullYear(),
              end.getMonth(),
              end.getDate() - 1
            );
            end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
            break;
          case "week":
            start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "month":
            start = new Date(end.getFullYear(), end.getMonth(), 1);
            break;
          case "quarter":
            start = new Date(
              end.getFullYear(),
              Math.floor(end.getMonth() / 3) * 3,
              1
            );
            break;
          case "year":
            start = new Date(end.getFullYear(), 0, 1);
            break;
          default:
            start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
      }

      // Get comprehensive analytics
      const analyticsQuery = `
        SELECT 
          COUNT(*) as total_orders,
          COALESCE(SUM("finalAmount"), 0) as total_revenue,
          COALESCE(AVG("finalAmount"), 0) as avg_order_value,
          COUNT(DISTINCT "customerName") as unique_customers,
          COUNT(CASE WHEN "paymentStatus" IN ('paid', 'PAID') THEN 1 END) as paid_orders,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_orders,
          COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_orders
        FROM orders 
        WHERE "tenantId" = $1 
          AND "createdAt" >= $2 
          AND "createdAt" <= $3
      `;
      const analyticsResult = await executeQuery(analyticsQuery, [
        tenantId,
        start,
        end,
      ]);
      const analytics = analyticsResult.rows[0];

      // Get previous period for comparison
      const periodDiff = end.getTime() - start.getTime();
      const prevStart = new Date(start.getTime() - periodDiff);
      const prevEnd = new Date(start.getTime());

      const prevAnalyticsResult = await executeQuery(analyticsQuery, [
        tenantId,
        prevStart,
        prevEnd,
      ]);
      const prevAnalytics = prevAnalyticsResult.rows[0];

      // Calculate growth percentages
      const calculateGrowth = (current: number, previous: number) => {
        return previous > 0 ? ((current - previous) / previous) * 100 : 0;
      };

      const growth = {
        orders: calculateGrowth(
          parseInt(analytics.total_orders),
          parseInt(prevAnalytics.total_orders)
        ),
        revenue: calculateGrowth(
          parseFloat(analytics.total_revenue),
          parseFloat(prevAnalytics.total_revenue)
        ),
        avgOrderValue: calculateGrowth(
          parseFloat(analytics.avg_order_value),
          parseFloat(prevAnalytics.avg_order_value)
        ),
        customers: calculateGrowth(
          parseInt(analytics.unique_customers),
          parseInt(prevAnalytics.unique_customers)
        ),
      };

      // Get top items for the period
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
      LIMIT 10
    `;
      const topItemsResult = await executeQuery(topItemsQuery, [
        tenantId,
        start,
        end,
      ]);
      const topItems = topItemsResult.rows.map((row: any) => ({
        menuItemId: row.menu_item_id,
        name: row.menu_item_name,
        quantity: parseInt(row.total_quantity),
        revenue: parseFloat(row.total_revenue),
        orderCount: parseInt(row.order_count),
      }));

      // Get daily breakdown
      const dailyQuery = `
      SELECT 
        DATE("createdAt") as date,
        COUNT(*) as orders,
        COALESCE(SUM("finalAmount"), 0) as revenue,
        COUNT(DISTINCT "customerPhone") as customers
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'cancelled'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;
      const dailyResult = await executeQuery(dailyQuery, [
        tenantId,
        start,
        end,
      ]);
      const dailyData = dailyResult.rows.map((row: any) => ({
        date: row.date,
        orders: parseInt(row.orders),
        revenue: parseFloat(row.revenue),
        customers: parseInt(row.customers),
      }));

      sendSuccess(res, {
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
          type: period,
        },
        summary: {
          totalOrders: parseInt(analytics.total_orders),
          totalRevenue: parseFloat(analytics.total_revenue),
          avgOrderValue: parseFloat(analytics.avg_order_value),
          uniqueCustomers: parseInt(analytics.unique_customers),
          orderStatus: {
            paid: parseInt(analytics.paid_orders),
            cancelled: parseInt(analytics.cancelled_orders),
            active: parseInt(analytics.active_orders),
            closed: parseInt(analytics.closed_orders),
          },
        },
        growth,
        topItems,
        dailyData,
      });
    } catch (error) {
      logger.error("Get comprehensive analytics error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch comprehensive analytics");
    }
  }
);

export default router;
