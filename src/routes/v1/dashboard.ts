import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/response';
import { executeQuery } from '../../utils/database';

const router = Router();

// ==================== DASHBOARD ====================

// GET /api/dashboard/overview - Get dashboard overview data
router.get('/overview', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER', 'WAITER', 'CASHIER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { period = 'month' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;
    let endDate = now;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get total orders
    const totalOrdersQuery = `
      SELECT COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'CANCELLED'
    `;
    const totalOrdersResult = await executeQuery(totalOrdersQuery, [tenantId, startDate, endDate]);
    const totalOrders = parseInt(totalOrdersResult.rows[0].count);

    // Get previous period for comparison
    const periodDiff = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodDiff);
    const prevEndDate = new Date(startDate.getTime());

    const prevOrdersResult = await executeQuery(totalOrdersQuery, [tenantId, prevStartDate, prevEndDate]);
    const prevOrders = parseInt(prevOrdersResult.rows[0].count);
    const orderGrowth = prevOrders > 0 ? ((totalOrders - prevOrders) / prevOrders) * 100 : 0;

    // Get active orders
    const activeOrdersQuery = `
      SELECT COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND status IN ('PENDING', 'PREPARING', 'READY')
    `;
    const activeOrdersResult = await executeQuery(activeOrdersQuery, [tenantId]);
    const activeOrders = parseInt(activeOrdersResult.rows[0].count);

    // Get total revenue
    const totalRevenueQuery = `
      SELECT COALESCE(SUM("finalAmount"), 0) as total
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'CANCELLED'
    `;
    const totalRevenueResult = await executeQuery(totalRevenueQuery, [tenantId, startDate, endDate]);
    const totalRevenue = parseFloat(totalRevenueResult.rows[0].total);

    const prevRevenueResult = await executeQuery(totalRevenueQuery, [tenantId, prevStartDate, prevEndDate]);
    const prevRevenue = parseFloat(prevRevenueResult.rows[0].total);
    const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Get average order value
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const prevAvgOrderValue = prevOrders > 0 ? prevRevenue / prevOrders : 0;
    const avgOrderGrowth = prevAvgOrderValue > 0 ? ((avgOrderValue - prevAvgOrderValue) / prevAvgOrderValue) * 100 : 0;

    // Get total customers (unique customers)
    const totalCustomersQuery = `
      SELECT COUNT(DISTINCT "customerPhone") as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND "customerPhone" IS NOT NULL
        AND status != 'CANCELLED'
    `;
    const totalCustomersResult = await executeQuery(totalCustomersQuery, [tenantId, startDate, endDate]);
    const totalCustomers = parseInt(totalCustomersResult.rows[0].count);

    // Get new customers this week
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const newCustomersQuery = `
      SELECT COUNT(DISTINCT "customerPhone") as count
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "customerPhone" IS NOT NULL
        AND status != 'CANCELLED'
    `;
    const newCustomersResult = await executeQuery(newCustomersQuery, [tenantId, weekAgo]);
    const newCustomers = parseInt(newCustomersResult.rows[0].count);

    sendSuccess(res, {
      summary: {
        totalOrders: {
          value: totalOrders,
          growth: orderGrowth,
          period: period === 'month' ? 'This month' : `This ${period}`
        },
        activeOrders: {
          value: activeOrders,
          status: 'Currently processing'
        },
        totalRevenue: {
          value: totalRevenue,
          growth: revenueGrowth,
          period: period === 'month' ? 'This month' : `This ${period}`
        },
        totalCustomers: {
          value: totalCustomers,
          newThisWeek: newCustomers
        },
        avgOrderValue: {
          value: avgOrderValue,
          growth: avgOrderGrowth
        }
      }
    });
  } catch (error) {
    logger.error('Get dashboard overview error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch dashboard overview');
  }
});

// GET /api/dashboard/live-orders - Get live orders
router.get('/live-orders', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER', 'WAITER', 'CASHIER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

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
        AND o.status IN ('PENDING', 'PREPARING', 'READY')
      ORDER BY o."createdAt" ASC
    `;
    const result = await executeQuery(liveOrdersQuery, [tenantId]);
    const rows = result.rows;

    // Group orders and their items
    const ordersMap = new Map();
    rows.forEach((row: any) => {
      if (!ordersMap.has(row.id)) {
        const timeDiff = Math.floor((Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60));
        
        ordersMap.set(row.id, {
          id: row.id,
          tableNumber: row.tableNumber,
          items: [],
          total: parseFloat(row.finalAmount.toString()),
          status: row.status.toLowerCase(),
          waiterName: row.createdByUserName || (row.waiter_first_name && row.waiter_last_name ? `${row.waiter_first_name} ${row.waiter_last_name}` : 'Unknown'),
          createdAt: row.createdAt,
          timeAgo: `${timeDiff} min ago`,
          customerName: row.customerName,
          specialInstructions: row.specialInstructions
        });
      }

      if (row.menuItemId) {
        ordersMap.get(row.id).items.push({
          menuItemName: row.menu_item_name,
          quantity: row.quantity,
          price: parseFloat(row.unitPrice.toString()),
          notes: row.notes
        });
      }
    });

    const liveOrders = Array.from(ordersMap.values());

    sendSuccess(res, { orders: liveOrders });
  } catch (error) {
    logger.error('Get live orders error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch live orders');
  }
});

// GET /api/dashboard/revenue-trend - Get revenue trend data
router.get('/revenue-trend', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { days = 7 } = req.query;

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - parseInt(days as string) * 24 * 60 * 60 * 1000);

    const revenueQuery = `
      SELECT 
        DATE("createdAt") as date,
        COALESCE(SUM("finalAmount"), 0) as daily_revenue,
        COUNT(*) as daily_orders
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'CANCELLED'
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;
    const result = await executeQuery(revenueQuery, [tenantId, startDate, endDate]);
    const rows = result.rows;

    // Calculate growth percentage
    const totalRevenue = rows.reduce((sum: number, row: any) => sum + parseFloat(row.daily_revenue), 0);
    const prevPeriodStart = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()));
    const prevPeriodEnd = new Date(startDate.getTime());

    const prevRevenueResult = await executeQuery(revenueQuery, [tenantId, prevPeriodStart, prevPeriodEnd]);
    const prevRevenue = prevRevenueResult.rows.reduce((sum: number, row: any) => sum + parseFloat(row.daily_revenue), 0);
    const growth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    // Format daily data
    const dailyData = rows.map((row: any) => ({
      date: row.date,
      revenue: parseFloat(row.daily_revenue),
      orders: parseInt(row.daily_orders)
    }));

    sendSuccess(res, {
      growth,
      dailyData,
      totalRevenue
    });
  } catch (error) {
    logger.error('Get revenue trend error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch revenue trend');
  }
});

// GET /api/dashboard/peak-hours - Get peak hours analytics
router.get('/peak-hours', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { days = 30 } = req.query;

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - parseInt(days as string) * 24 * 60 * 60 * 1000);

    const peakHoursQuery = `
      SELECT 
        EXTRACT(HOUR FROM "createdAt") as hour,
        COUNT(*) as order_count,
        COALESCE(SUM("finalAmount"), 0) as revenue
      FROM orders 
      WHERE "tenantId" = $1 
        AND "createdAt" >= $2 
        AND "createdAt" <= $3
        AND status != 'CANCELLED'
      GROUP BY EXTRACT(HOUR FROM "createdAt")
      ORDER BY hour ASC
    `;
    const result = await executeQuery(peakHoursQuery, [tenantId, startDate, endDate]);
    const rows = result.rows;

    // Find max order count for normalization
    const maxOrders = Math.max(...rows.map((row: any) => parseInt(row.order_count)));

    const peakHours = rows.map((row: any) => ({
      hour: parseInt(row.hour),
      orderCount: parseInt(row.order_count),
      revenue: parseFloat(row.revenue),
      activity: maxOrders > 0 ? (parseInt(row.order_count) / maxOrders) * 100 : 0
    }));

    sendSuccess(res, { peakHours });
  } catch (error) {
    logger.error('Get peak hours error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch peak hours');
  }
});

// GET /api/dashboard/top-items - Get top selling items
router.get('/top-items', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { period = 'month', limit = 10 } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

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
      LIMIT $4
    `;
    const result = await executeQuery(topItemsQuery, [tenantId, startDate, now, parseInt(limit as string)]);
    const rows = result.rows;

    // Calculate total revenue for percentage
    const totalRevenue = rows.reduce((sum: number, row: any) => sum + parseFloat(row.total_revenue), 0);

    const topItems = rows.map((row: any, index: number) => ({
      rank: index + 1,
      menuItemId: row.menu_item_id,
      name: row.menu_item_name,
      quantity: parseInt(row.total_quantity),
      revenue: parseFloat(row.total_revenue),
      orderCount: parseInt(row.order_count),
      percentage: totalRevenue > 0 ? (parseFloat(row.total_revenue) / totalRevenue) * 100 : 0
    }));

    sendSuccess(res, { topItems, totalRevenue });
  } catch (error) {
    logger.error('Get top items error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch top items');
  }
});

// GET /api/dashboard/staff-performance - Get staff performance
router.get('/staff-performance', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { period = 'month' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

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
        AND o.status != 'CANCELLED'
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
      rating: 4.5 + Math.random() * 0.5 // Mock rating for now
    }));

    sendSuccess(res, { staffPerformance });
  } catch (error) {
    logger.error('Get staff performance error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch staff performance');
  }
});

// GET /api/dashboard/popular-combinations - Get popular item combinations
router.get('/popular-combinations', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { limit = 5 } = req.query;

    const combinationsQuery = `
      SELECT 
        o.id as order_id,
        STRING_AGG(mi.name, ' + ' ORDER BY mi.name) as combination,
        COUNT(*) as combination_count,
        SUM(oi."totalPrice") as total_revenue
      FROM orders o
      JOIN "orderItems" oi ON o.id = oi."orderId"
      JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1 
        AND o.status != 'CANCELLED'
        AND o."createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY o.id
      HAVING COUNT(*) = 2
      ORDER BY combination_count DESC, total_revenue DESC
      LIMIT $2
    `;
    const result = await executeQuery(combinationsQuery, [tenantId, parseInt(limit as string)]);
    const rows = result.rows;

    const combinations = rows.map((row: any) => ({
      combination: row.combination,
      orderCount: parseInt(row.combination_count),
      revenue: parseFloat(row.total_revenue)
    }));

    sendSuccess(res, { combinations });
  } catch (error) {
    logger.error('Get popular combinations error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch popular combinations');
  }
});

export default router; 