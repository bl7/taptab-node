import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/response';
import { executeQuery } from '../../utils/database';

const router = Router();

// ==================== ANALYTICS ====================

// GET /api/analytics/sales - Get sales analytics
router.get('/sales', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { startDate, endDate } = req.query;

    // Parse dates
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate as string) : new Date();

    // Get orders within date range
    const ordersQuery = `
      SELECT o.*, oi."menuItemId", oi.quantity, oi."totalPrice", mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1 
        AND o."createdAt" >= $2 
        AND o."createdAt" <= $3
        AND o.status != 'CANCELLED'
    `;
    const ordersResult = await executeQuery(ordersQuery, [tenantId, start, end]);
    const orders = ordersResult.rows;

    // Calculate analytics
    const totalSales = orders.reduce((sum: number, order: any) => {
      if (order.finalAmount) {
        return sum + parseFloat(order.finalAmount.toString());
      }
      return sum;
    }, 0);
    
    // Count unique orders
    const uniqueOrders = new Set(orders.map((order: any) => order.id));
    const totalOrders = uniqueOrders.size;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Calculate top items
    const itemSales: { [key: string]: { menuItemId: string; name: string; quantity: number; revenue: number } } = {};
    
    orders.forEach((order: any) => {
      if (order.menuItemId && order.menu_item_name) {
        const itemId = order.menuItemId;
        const itemName = order.menu_item_name;
        const quantity = order.quantity || 0;
        const revenue = parseFloat(order.totalPrice?.toString() || '0');

        if (itemSales[itemId]) {
          itemSales[itemId].quantity += quantity;
          itemSales[itemId].revenue += revenue;
        } else {
          itemSales[itemId] = {
            menuItemId: itemId,
            name: itemName,
            quantity,
            revenue
          };
        }
      }
    });

    const topItems = Object.values(itemSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Calculate daily sales
    const dailySales: { [key: string]: { date: string; sales: number; orders: number } } = {};
    
    orders.forEach((order: any) => {
      if (order.finalAmount) {
        const date = new Date(order.createdAt).toISOString().split('T')[0];
        const sales = parseFloat(order.finalAmount.toString());

        if (dailySales[date]) {
          dailySales[date].sales += sales;
          dailySales[date].orders += 1;
        } else {
          dailySales[date] = {
            date,
            sales,
            orders: 1
          };
        }
      }
    });

    const dailySalesArray = Object.values(dailySales).sort((a, b) => a.date.localeCompare(b.date));

    sendSuccess(res, {
      totalSales,
      totalOrders,
      averageOrderValue,
      topItems,
      dailySales: dailySalesArray
    });
  } catch (error) {
    logger.error('Get sales analytics error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch sales analytics');
  }
});

// GET /api/analytics/orders - Get order analytics
router.get('/orders', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status, tableId, startDate, endDate } = req.query;

    // Parse dates
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));
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

    const activeOrders = statusCounts.active || 0;
    const paidOrders = statusCounts.paid || 0;
    const cancelledOrders = statusCounts.cancelled || 0;

    sendSuccess(res, {
      activeOrders,
      paidOrders,
      cancelledOrders,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    });
  } catch (error) {
    logger.error('Get order analytics error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch order analytics');
  }
});

// GET /api/analytics/comprehensive - Get comprehensive analytics with date range
router.get('/comprehensive', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { startDate, endDate, period = 'custom' } = req.query;

    // Parse dates based on period or custom dates
    let start: Date;
    let end = new Date();

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    } else {
      // Default periods
      switch (period) {
        case 'today':
          start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
          break;
        case 'yesterday':
          start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
          end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'week':
          start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          start = new Date(end.getFullYear(), end.getMonth(), 1);
          break;
        case 'quarter':
          start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
          break;
        case 'year':
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
        AVG("finalAmount") as avg_order_value,
        COUNT(DISTINCT "customerPhone") as unique_customers,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'PREPARING' THEN 1 END) as preparing_orders,
        COUNT(CASE WHEN status = 'READY' THEN 1 END) as ready_orders,
        COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid_orders,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled_orders
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
    `;
    const analyticsResult = await executeQuery(analyticsQuery, [tenantId, start, end]);
    const analytics = analyticsResult.rows[0];

    // Get previous period for comparison
    const periodDiff = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - periodDiff);
    const prevEnd = new Date(start.getTime());

    const prevAnalyticsResult = await executeQuery(analyticsQuery, [tenantId, prevStart, prevEnd]);
    const prevAnalytics = prevAnalyticsResult.rows[0];

    // Calculate growth percentages
    const calculateGrowth = (current: number, previous: number) => {
      return previous > 0 ? ((current - previous) / previous) * 100 : 0;
    };

    const growth = {
      orders: calculateGrowth(parseInt(analytics.total_orders), parseInt(prevAnalytics.total_orders)),
      revenue: calculateGrowth(parseFloat(analytics.total_revenue), parseFloat(prevAnalytics.total_revenue)),
      avgOrderValue: calculateGrowth(parseFloat(analytics.avg_order_value), parseFloat(prevAnalytics.avg_order_value)),
      customers: calculateGrowth(parseInt(analytics.unique_customers), parseInt(prevAnalytics.unique_customers))
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
        AND o.status != 'CANCELLED'
      GROUP BY mi.id, mi.name
      ORDER BY total_revenue DESC
      LIMIT 10
    `;
    const topItemsResult = await executeQuery(topItemsQuery, [tenantId, start, end]);
    const topItems = topItemsResult.rows.map((row: any) => ({
      menuItemId: row.menu_item_id,
      name: row.menu_item_name,
      quantity: parseInt(row.total_quantity),
      revenue: parseFloat(row.total_revenue),
      orderCount: parseInt(row.order_count)
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
        AND status != 'CANCELLED'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;
    const dailyResult = await executeQuery(dailyQuery, [tenantId, start, end]);
    const dailyData = dailyResult.rows.map((row: any) => ({
      date: row.date,
      orders: parseInt(row.orders),
      revenue: parseFloat(row.revenue),
      customers: parseInt(row.customers)
    }));

    sendSuccess(res, {
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        type: period
      },
      summary: {
        totalOrders: parseInt(analytics.total_orders),
        totalRevenue: parseFloat(analytics.total_revenue),
        avgOrderValue: parseFloat(analytics.avg_order_value),
        uniqueCustomers: parseInt(analytics.unique_customers),
        orderStatus: {
          pending: parseInt(analytics.pending_orders),
          preparing: parseInt(analytics.preparing_orders),
          ready: parseInt(analytics.ready_orders),
          paid: parseInt(analytics.paid_orders),
          cancelled: parseInt(analytics.cancelled_orders)
        }
      },
      growth,
      topItems,
      dailyData
    });
  } catch (error) {
    logger.error('Get comprehensive analytics error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch comprehensive analytics');
  }
});

export default router; 