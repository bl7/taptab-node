import { executeQuery } from "../utils/database";

export interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  tableNumber?: string;
  paymentMethod?: string;
  status?: string;
}

export interface SalesMetrics {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  topSellingItems: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    revenue: number;
  }>;
}

export interface TableMetrics {
  tableNumber: string;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  utilizationRate: number;
}

export class AnalyticsService {
  /**
   * Get sales analytics for a tenant
   */
  static async getSalesAnalytics(
    tenantId: string,
    filters: AnalyticsFilters = {}
  ): Promise<SalesMetrics> {
    let query = `
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        SUM(o."finalAmount") as total_sales,
        AVG(o."finalAmount") as average_order_value
      FROM orders o
      WHERE o."tenantId" = $1 AND o.status IN ('active', 'closed', 'paid')
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.startDate) {
      query += ` AND o."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND o."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    if (filters.tableNumber) {
      query += ` AND o."tableNumber" = $${paramIndex++}`;
      values.push(filters.tableNumber);
    }

    const salesResult = await executeQuery(query, values);
    const salesData = salesResult.rows[0];

    // Get top selling items
    let topItemsQuery = `
      SELECT 
        oi."menuItemId",
        mi.name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi."totalPrice") as total_revenue
      FROM "orderItems" oi
      JOIN orders o ON oi."orderId" = o.id
      JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1 AND o.status IN ('active', 'closed', 'paid')
    `;

    const topItemsValues = [tenantId];
    let topItemsParamIndex = 2;

    if (filters.startDate) {
      topItemsQuery += ` AND o."createdAt" >= $${topItemsParamIndex++}`;
      topItemsValues.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      topItemsQuery += ` AND o."createdAt" <= $${topItemsParamIndex++}`;
      topItemsValues.push(filters.endDate.toISOString());
    }

    topItemsQuery += ` GROUP BY oi."menuItemId", mi.name ORDER BY total_quantity DESC LIMIT 10`;

    const topItemsResult = await executeQuery(topItemsQuery, topItemsValues);

    return {
      totalSales: parseFloat(salesData.total_sales || "0"),
      totalOrders: parseInt(salesData.total_orders || "0"),
      averageOrderValue: parseFloat(salesData.average_order_value || "0"),
      topSellingItems: topItemsResult.rows.map((row) => ({
        menuItemId: row.menuItemId,
        name: row.name,
        quantity: parseInt(row.total_quantity),
        revenue: parseFloat(row.total_revenue),
      })),
    };
  }

  /**
   * Get table performance analytics
   */
  static async getTableAnalytics(
    tenantId: string,
    filters: AnalyticsFilters = {}
  ): Promise<TableMetrics[]> {
    let query = `
      SELECT 
        t.number as table_number,
        COUNT(o.id) as total_orders,
        SUM(o."finalAmount") as total_revenue,
        AVG(o."finalAmount") as average_order_value,
        COUNT(o.id) * 100.0 / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - t."createdAt")) / 3600) as utilization_rate
      FROM tables t
      LEFT JOIN orders o ON t.id = o."tableNumber" AND o.status = 'completed'
      WHERE t."tenantId" = $1 AND t."isActive" = true
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.startDate) {
      query += ` AND o."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND o."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    query += ` GROUP BY t.id, t.number, t."createdAt" ORDER BY total_revenue DESC`;

    const result = await executeQuery(query, values);

    return result.rows.map((row) => ({
      tableNumber: row.table_number,
      totalOrders: parseInt(row.total_orders || "0"),
      totalRevenue: parseFloat(row.total_revenue || "0"),
      averageOrderValue: parseFloat(row.average_order_value || "0"),
      utilizationRate: parseFloat(row.utilization_rate || "0"),
    }));
  }

  /**
   * Get peak hours analytics
   */
  static async getPeakHoursAnalytics(tenantId: string, days: number = 7) {
    const query = `
      SELECT 
        EXTRACT(DOW FROM o."createdAt") as day_of_week,
        EXTRACT(HOUR FROM o."createdAt") as hour_of_day,
        COUNT(*) as order_count,
        AVG(o."finalAmount") as average_amount
      FROM orders o
      WHERE o."tenantId" = $1 
        AND o.status IN ('active', 'closed', 'paid')
        AND o."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY EXTRACT(DOW FROM o."createdAt"), EXTRACT(HOUR FROM o."createdAt")
      ORDER BY day_of_week, hour_of_day
    `;

    const result = await executeQuery(query, [tenantId]);

    // Group by day and hour
    const peakHoursByDay: any = {};
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    result.rows.forEach((row) => {
      const dayIndex = parseInt(row.day_of_week);
      const dayName = dayNames[dayIndex];
      const hour = parseInt(row.hour_of_day);

      if (dayName && !peakHoursByDay[dayName]) {
        peakHoursByDay[dayName] = { hours: {} };
      }

      if (dayName && peakHoursByDay[dayName]) {
        peakHoursByDay[dayName].hours[hour] = {
          orderCount: parseInt(row.order_count),
          averageAmount: parseFloat(row.average_amount),
        };
      }
    });

    return peakHoursByDay;
  }

  /**
   * Get payment method analytics
   */
  static async getPaymentMethodAnalytics(
    tenantId: string,
    filters: AnalyticsFilters = {}
  ) {
    let query = `
      SELECT 
        o."paymentMethod",
        COUNT(*) as order_count,
        SUM(o."finalAmount") as total_revenue,
        AVG(o."finalAmount") as average_amount
      FROM orders o
      WHERE o."tenantId" = $1 AND o.status IN ('active', 'closed', 'paid')
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.startDate) {
      query += ` AND o."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND o."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    query += ` GROUP BY o."paymentMethod" ORDER BY total_revenue DESC`;

    const result = await executeQuery(query, values);

    return result.rows.map((row) => ({
      paymentMethod: row.paymentMethod || "unknown",
      orderCount: parseInt(row.order_count),
      totalRevenue: parseFloat(row.total_revenue),
      averageAmount: parseFloat(row.average_amount),
    }));
  }

  /**
   * Get customer analytics
   */
  static async getCustomerAnalytics(
    tenantId: string,
    filters: AnalyticsFilters = {}
  ) {
    let query = `
      SELECT 
        o."customerName",
        o."customerPhone",
        COUNT(*) as order_count,
        SUM(o."finalAmount") as total_spent,
        AVG(o."finalAmount") as average_order,
        MAX(o."createdAt") as last_order_date
      FROM orders o
      WHERE o."tenantId" = $1 AND o.status IN ('active', 'closed', 'paid')
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.startDate) {
      query += ` AND o."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND o."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    query += ` GROUP BY o."customerName", o."customerPhone" ORDER BY total_spent DESC LIMIT 50`;

    const result = await executeQuery(query, values);

    return result.rows.map((row) => ({
      customerName: row.customerName || "Anonymous",
      customerPhone: row.customerPhone || "",
      orderCount: parseInt(row.order_count),
      totalSpent: parseFloat(row.total_spent),
      averageOrder: parseFloat(row.average_order),
      lastOrderDate: row.last_order_date,
    }));
  }

  /**
   * Get daily revenue trend
   */
  static async getDailyRevenueTrend(tenantId: string, days: number = 30) {
    const query = `
      SELECT 
        DATE(o."createdAt") as date,
        COUNT(*) as order_count,
        SUM(o."finalAmount") as daily_revenue,
        AVG(o."finalAmount") as average_order
      FROM orders o
      WHERE o."tenantId" = $1 
        AND o.status IN ('active', 'closed', 'paid')
        AND o."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(o."createdAt")
      ORDER BY date DESC
    `;

    const result = await executeQuery(query, [tenantId]);

    return result.rows.map((row) => ({
      date: row.date,
      orderCount: parseInt(row.order_count),
      dailyRevenue: parseFloat(row.daily_revenue),
      averageOrder: parseFloat(row.average_order),
    }));
  }

  /**
   * Get inventory turnover analytics
   */
  static async getInventoryTurnoverAnalytics(
    tenantId: string,
    filters: AnalyticsFilters = {}
  ) {
    let query = `
      SELECT 
        mi.name as item_name,
        mi.id as item_id,
        SUM(oi.quantity) as total_ordered,
        SUM(oi."totalPrice") as total_revenue,
        COUNT(DISTINCT o.id) as order_frequency
      FROM "menuItems" mi
      JOIN "orderItems" oi ON mi.id = oi."menuItemId"
      JOIN orders o ON oi."orderId" = o.id
      WHERE mi."tenantId" = $1 AND o.status IN ('active', 'closed', 'paid')
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.startDate) {
      query += ` AND o."createdAt" >= $${paramIndex++}`;
      values.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query += ` AND o."createdAt" <= $${paramIndex++}`;
      values.push(filters.endDate.toISOString());
    }

    query += ` GROUP BY mi.id, mi.name ORDER BY total_ordered DESC LIMIT 20`;

    const result = await executeQuery(query, values);

    return result.rows.map((row) => ({
      itemName: row.item_name,
      itemId: row.item_id,
      totalOrdered: parseInt(row.total_ordered),
      totalRevenue: parseFloat(row.total_revenue),
      orderFrequency: parseInt(row.order_frequency),
    }));
  }

  /**
   * Get top selling items for a tenant
   */
  static async getTopItems(
    tenantId: string,
    period: string = "week",
    limit: number = 10
  ): Promise<
    Array<{
      menuItemId: string;
      name: string;
      quantity: number;
      revenue: number;
      orderCount: number;
    }>
  > {
    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "day":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Default to week
    }

    const query = `
      SELECT 
        oi."menuItemId",
        mi.name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi."totalPrice") as total_revenue,
        COUNT(DISTINCT o.id) as order_count
      FROM "orderItems" oi
      JOIN orders o ON oi."orderId" = o.id
      JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1 
        AND o.status IN ('active', 'closed', 'paid')
        AND o."createdAt" >= $2
      GROUP BY oi."menuItemId", mi.name 
      ORDER BY total_quantity DESC 
      LIMIT $3
    `;

    const result = await executeQuery(query, [
      tenantId,
      startDate.toISOString(),
      limit,
    ]);

    return result.rows.map((row: any) => ({
      menuItemId: row.menuItemId,
      name: row.name,
      quantity: parseInt(row.total_quantity),
      revenue: parseFloat(row.total_revenue),
      orderCount: parseInt(row.order_count),
    }));
  }

  /**
   * Get staff performance analytics for a tenant
   */
  static async getStaffPerformance(
    tenantId: string,
    period: string = "week"
  ): Promise<
    Array<{
      userId: string;
      userName: string;
      ordersProcessed: number;
      totalRevenue: number;
      averageOrderValue: number;
    }>
  > {
    // Calculate date range based on period
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "day":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Default to week
    }

    const query = `
      SELECT 
        o."createdByUserId" as user_id,
        u.name as user_name,
        COUNT(DISTINCT o.id) as orders_processed,
        SUM(o."finalAmount") as total_revenue,
        AVG(o."finalAmount") as average_order_value
      FROM orders o
      LEFT JOIN users u ON o."createdByUserId" = u.id
      WHERE o."tenantId" = $1 
        AND o.status IN ('active', 'closed', 'paid')
        AND o."createdAt" >= $2
        AND o."createdByUserId" IS NOT NULL
      GROUP BY o."createdByUserId", u.name
      ORDER BY orders_processed DESC
    `;

    const result = await executeQuery(query, [
      tenantId,
      startDate.toISOString(),
    ]);

    return result.rows.map((row: any) => ({
      userId: row.user_id,
      userName: row.user_name || "Unknown Staff",
      ordersProcessed: parseInt(row.orders_processed),
      totalRevenue: parseFloat(row.total_revenue || "0"),
      averageOrderValue: parseFloat(row.average_order_value || "0"),
    }));
  }

  /**
   * Get popular item combinations for a tenant
   */
  static async getPopularCombinations(
    tenantId: string,
    limit: number = 5
  ): Promise<
    Array<{
      items: Array<{
        menuItemId: string;
        name: string;
      }>;
      frequency: number;
      totalRevenue: number;
    }>
  > {
    const query = `
      WITH order_combinations AS (
        SELECT 
          o.id as order_id,
          ARRAY_AGG(oi."menuItemId" ORDER BY oi."menuItemId") as item_ids,
          ARRAY_AGG(mi.name ORDER BY oi."menuItemId") as item_names,
          SUM(oi."totalPrice") as combination_revenue
        FROM orders o
        JOIN "orderItems" oi ON o.id = oi."orderId"
        JOIN "menuItems" mi ON oi."menuItemId" = mi.id
        WHERE o."tenantId" = $1 
          AND o.status IN ('active', 'closed', 'paid')
          AND o."createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY o.id
        HAVING COUNT(oi.id) > 1
      ),
      combination_stats AS (
        SELECT 
          item_ids,
          item_names,
          COUNT(*) as frequency,
          SUM(combination_revenue) as total_revenue
        FROM order_combinations
        GROUP BY item_ids, item_names
        ORDER BY frequency DESC, total_revenue DESC
        LIMIT $2
      )
      SELECT 
        item_ids,
        item_names,
        frequency,
        total_revenue
      FROM combination_stats
    `;

    const result = await executeQuery(query, [tenantId, limit]);

    return result.rows.map((row: any) => ({
      items: row.item_ids.map((itemId: string, index: number) => ({
        menuItemId: itemId,
        name: row.item_names[index],
      })),
      frequency: parseInt(row.frequency),
      totalRevenue: parseFloat(row.total_revenue),
    }));
  }
}
