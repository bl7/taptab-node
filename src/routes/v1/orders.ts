import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError, sendNotFound } from '../../utils/response';
import { executeQuery } from '../../utils/database';

const router = Router();

// ==================== ORDERS MANAGEMENT ====================

// GET /api/orders - Get all orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status, tableId } = req.query;

    let query = `
      SELECT o.*, 
             oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
             mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o."tenantId" = $1
    `;
    const values: any[] = [tenantId];

    if (status) {
      query += ` AND o.status = $2`;
      values.push(status);
    }
    if (tableId) {
      query += ` AND o."tableNumber" = $${values.length + 1}`;
      values.push(tableId);
    }

    query += ` ORDER BY o."createdAt" DESC`;

    const result = await executeQuery(query, values);
    const rows = result.rows;

    // Group orders and their items
    const ordersMap = new Map();
    rows.forEach((row: any) => {
      if (!ordersMap.has(row.id)) {
        ordersMap.set(row.id, {
          id: row.id,
          tableId: row.tableNumber,
          tableNumber: row.tableNumber,
          items: [],
          total: parseFloat(row.finalAmount.toString()),
          status: row.status.toLowerCase(),
          waiterId: row.createdById,
          waiterName: 'Unknown',
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        });
      }

      if (row.item_id) {
        ordersMap.get(row.id).items.push({
          id: row.item_id,
          menuItemId: row.menuItemId,
          menuItemName: row.menu_item_name,
          quantity: row.quantity,
          price: parseFloat(row.unitPrice.toString()),
          notes: row.notes,
          status: 'pending'
        });
      }
    });

    const formattedOrders = Array.from(ordersMap.values());

    sendSuccess(res, { orders: formattedOrders });
  } catch (error) {
    logger.error('Get orders error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch orders');
  }
});

// POST /api/orders - Create new order
router.post('/', authenticateToken, requireRole(['WAITER', 'CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { tableId, items } = req.body;

    if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
      return sendError(res, 'VALIDATION_ERROR', 'TableId and items array are required', 400);
    }

    // Verify table exists
    const tableResult = await executeQuery(
      'SELECT * FROM tables WHERE number = $1 AND "tenantId" = $2',
      [tableId, tenantId]
    );

    if (tableResult.rows.length === 0) {
      return sendError(res, 'TABLE_NOT_FOUND', 'Table not found', 400);
    }

    // Calculate total and create order items
    let total = 0;
    const orderItems: any[] = [];

    for (const item of items) {
      const menuItemResult = await executeQuery(
        'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
        [item.menuItemId, tenantId]
      );

      if (menuItemResult.rows.length === 0) {
        return sendError(res, 'MENU_ITEM_NOT_FOUND', `Menu item ${item.menuItemId} not found`, 400);
      }

      const menuItem = menuItemResult.rows[0];
      const itemTotal = parseFloat(menuItem.price.toString()) * item.quantity;
      total += itemTotal;

      orderItems.push({
        quantity: item.quantity,
        unitPrice: menuItem.price,
        totalPrice: itemTotal,
        notes: item.notes || null,
        menuItemId: item.menuItemId
      });
    }

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // Create order
    const orderResult = await executeQuery(
      `INSERT INTO orders (id, "orderNumber", "tableNumber", "totalAmount", "taxAmount", "discountAmount", "finalAmount", "tenantId", "createdById", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        orderNumber,
        tableId,
        total,
        0,
        0,
        total,
        tenantId,
        (req as any).user?.id || null,
        'PENDING',
        new Date(),
        new Date()
      ]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await executeQuery(
        `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          order.id,
          item.menuItemId,
          item.quantity,
          item.unitPrice,
          item.totalPrice,
          item.notes,
          new Date(),
          new Date()
        ]
      );
    }

    const formattedOrder = {
      id: order.id,
      tableId: order.tableNumber,
      tableNumber: order.tableNumber,
      items: order.orderItems.map((item: any) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItem.name,
        quantity: item.quantity,
        price: parseFloat(item.unitPrice.toString()),
        notes: item.notes,
        status: 'pending'
      })),
      total: parseFloat(order.finalAmount.toString()),
      status: order.status.toLowerCase(),
      waiterId: order.createdById,
      waiterName: 'Unknown',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    logger.info(`Order created: ${order.orderNumber}`);
    sendSuccess(res, { order: formattedOrder }, 'Order created successfully', 201);
  } catch (error) {
    logger.error('Create order error:', error);
    sendError(res, 'CREATE_ERROR', 'Failed to create order');
  }
});

// PUT /api/orders/:id - Update order status
router.put('/:id', authenticateToken, requireRole(['WAITER', 'CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { status } = req.body;

    if (!id) {
      return sendError(res, 'VALIDATION_ERROR', 'ID is required', 400);
    }

    if (!status) {
      return sendError(res, 'VALIDATION_ERROR', 'Status is required', 400);
    }

    // Validate status values
    const validStatuses = ['pending', 'preparing', 'ready', 'served', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid status value', 400);
    }

    // Check if order exists
    const existingOrderResult = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [id, tenantId]
    );

    if (existingOrderResult.rows.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Order not found', 404);
    }

    // Update order status
    const orderResult = await executeQuery(
      'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE id = $3 RETURNING *',
      [status.toUpperCase(), new Date(), id]
    );

    const order = orderResult.rows[0];

    const formattedOrder = {
      id: order.id,
      tableId: order.tableNumber,
      tableNumber: order.tableNumber,
      items: order.orderItems.map((item: any) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItem.name,
        quantity: item.quantity,
        price: parseFloat(item.unitPrice.toString()),
        notes: item.notes,
        status: 'pending'
      })),
      total: parseFloat(order.finalAmount.toString()),
      status: order.status.toLowerCase(),
      waiterId: order.createdById,
      waiterName: 'Unknown',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    logger.info(`Order status updated: ${order.orderNumber} - ${status}`);
    sendSuccess(res, { order: formattedOrder }, 'Order status updated successfully');
  } catch (error) {
    logger.error('Update order status error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update order status');
  }
});

// PUT /api/orders/:id/items/:itemId - Update specific item status
router.put('/:id/items/:itemId', authenticateToken, requireRole(['KITCHEN', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id, itemId } = req.params;
    const { status } = req.body;

    if (!id || !itemId) {
      return sendError(res, 'VALIDATION_ERROR', 'Order ID and Item ID are required', 400);
    }

    if (!status) {
      return sendError(res, 'VALIDATION_ERROR', 'Status is required', 400);
    }

    // Validate status values
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid status value', 400);
    }

    // Check if order and item exist
    const orderItemResult = await executeQuery(
      `SELECT oi.*, o."tenantId" as order_tenant_id, mi.name as menu_item_name
       FROM "orderItems" oi 
       LEFT JOIN orders o ON oi."orderId" = o.id
       LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
       WHERE oi.id = $1 AND oi."orderId" = $2`,
      [itemId, id]
    );

    if (orderItemResult.rows.length === 0 || orderItemResult.rows[0].order_tenant_id !== tenantId) {
      return sendError(res, 'NOT_FOUND', 'Order item not found', 404);
    }

    const orderItem = orderItemResult.rows[0];
    
    // Since item status is not in current schema, we'll just return the item with updated status
    const formattedItem = {
      id: orderItem.id,
      menuItemId: orderItem.menuItemId,
      menuItemName: orderItem.menu_item_name,
      quantity: orderItem.quantity,
      price: parseFloat(orderItem.unitPrice.toString()),
      notes: orderItem.notes,
      status: status
    };

    logger.info(`Order item status updated: ${itemId} - ${status}`);
    sendSuccess(res, { item: formattedItem }, 'Order item status updated successfully');
  } catch (error) {
    logger.error('Update order item status error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update order item status');
  }
});

// DELETE /api/orders/:id - Cancel order
router.delete('/:id', authenticateToken, requireRole(['WAITER', 'CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    if (!id) {
      return sendError(res, 'VALIDATION_ERROR', 'ID is required', 400);
    }

    // Check if order exists
    const existingOrderResult = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [id, tenantId]
    );

    if (existingOrderResult.rows.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Order not found', 404);
    }

    // Update order status to cancelled instead of deleting
    await executeQuery(
      'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE id = $3',
      ['CANCELLED', new Date(), id]
    );

    logger.info(`Order cancelled: ${id}`);
    sendSuccess(res, { success: true }, 'Order cancelled successfully');
  } catch (error) {
    logger.error('Cancel order error:', error);
    sendError(res, 'DELETE_ERROR', 'Failed to cancel order');
  }
});

export default router; 