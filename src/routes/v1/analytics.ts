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
    const { status, tableId } = req.query;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (tableId) where.tableNumber = tableId;

    const ordersQuery = `
      SELECT status, COUNT(*) as count
      FROM orders 
      WHERE "tenantId" = $1
      GROUP BY status
    `;
    const ordersResult = await executeQuery(ordersQuery, [tenantId]);
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
      cancelledOrders
    });
  } catch (error) {
    logger.error('Get order analytics error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch order analytics');
  }
});

export default router; 