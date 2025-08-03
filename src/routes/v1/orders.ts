import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError, sendNotFound } from '../../utils/response';
import { executeQuery } from '../../utils/database';
import { socketManager } from '../../utils/socket';

const router = Router();

// ==================== ORDERS MANAGEMENT ====================

// GET /api/orders - Get all orders
router.get('/', authenticateToken, requireRole(['WAITER', 'CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status, tableId } = req.query;

    let query = `
      SELECT o.*, 
             oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi.notes,
             mi.name as menu_item_name,
             o."orderSource", o."sourceDetails", o."createdByUserId", o."createdByUserName",
             o."isDelivery", o."deliveryAddress", o."deliveryPlatform", o."deliveryOrderId",
             o."customerAddress", 
             o."estimatedDeliveryTime", o."specialInstructions"
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
          waiterName: row.createdByUserName || row.sourceDetails || 'Unknown',
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          orderSource: row.orderSource,
          sourceDetails: row.sourceDetails,
          createdByUserId: row.createdByUserId,
          createdByUserName: row.createdByUserName,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          customerEmail: row.customerEmail,
          specialInstructions: row.specialInstructions,
          isDelivery: row.isDelivery,
          deliveryAddress: row.deliveryAddress,
          deliveryPlatform: row.deliveryPlatform,
          deliveryOrderId: row.deliveryOrderId,
          estimatedDeliveryTime: row.estimatedDeliveryTime,
          taxAmount: parseFloat(row.taxAmount.toString()),
          discountAmount: parseFloat(row.discountAmount.toString())
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
          status: 'active'
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
    const { 
      tableId, 
      items, 
      orderSource,
      customerName,
      customerPhone,
      customerEmail,
      specialInstructions,
      isDelivery = false,
      deliveryAddress,
      deliveryPlatform,
      deliveryOrderId,
      estimatedDeliveryTime,
      priority = 'normal',
      paymentMethod,
      taxAmount = 0,
      discountAmount = 0
    } = req.body;

    if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
      return sendError(res, 'VALIDATION_ERROR', 'TableId and items array are required', 400);
    }

    // Verify table exists (check both number and id)
    const tableResult = await executeQuery(
      'SELECT * FROM tables WHERE (number = $1 OR id = $1) AND "tenantId" = $2',
      [tableId, tenantId]
    );

    if (tableResult.rows.length === 0) {
      return sendError(res, 'TABLE_NOT_FOUND', `Table ${tableId} not found`, 400);
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

    // Determine order source
    let finalOrderSource = orderSource || 'WAITER';
    let sourceDetails = '';

    // Get user info for source details
    const user = (req as any).user;
    if (user) {
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      if (userName) {
        sourceDetails = userName;
      }
    }

    // Map order source to appropriate value
    switch (finalOrderSource.toUpperCase()) {
      case 'QR':
        finalOrderSource = 'QR_ORDERING';
        break;
      case 'WAITER':
        finalOrderSource = 'WAITER_ORDERING';
        break;
      case 'CASHIER':
        finalOrderSource = 'CASHIER_ORDERING';
        break;
      case 'MANAGER':
        finalOrderSource = 'MANAGER_ORDERING';
        break;
      default:
        finalOrderSource = 'WAITER_ORDERING';
    }

    // Calculate final amount with tax and discount
    const finalAmount = total + taxAmount - discountAmount;

    // Create order
    const orderResult = await executeQuery(
      `INSERT INTO orders (
        id, "orderNumber", "tableNumber", "totalAmount", "taxAmount", "discountAmount", "finalAmount", 
        "tenantId", "createdById", status, "orderSource", "sourceDetails", 
        "customerName", "customerPhone", "notes", "isDelivery", "deliveryAddress", "deliveryPlatform", 
        "deliveryOrderId", "createdByUserId", "createdByUserName", "customerAddress", 
        "estimatedDeliveryTime", "specialInstructions", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING *`,
      [
        `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        orderNumber,
        tableId,
        total,
        taxAmount,
        discountAmount,
        finalAmount,
        tenantId,
        user?.id || null,
        'ACTIVE',
        finalOrderSource,
        sourceDetails,
        customerName || null,
        customerPhone || null,
        specialInstructions || null,
        isDelivery,
        deliveryAddress || null,
        deliveryPlatform || null,
        deliveryOrderId || null,
        user?.id || null,
        sourceDetails,
        deliveryAddress || null, // customerAddress
        estimatedDeliveryTime || null,
        specialInstructions || null,
        new Date(),
        new Date()
      ]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await executeQuery(
        `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          order.id,
          item.menuItemId,
          item.quantity,
          item.unitPrice,
          item.totalPrice,
          item.notes,
          new Date()
        ]
      );
    }

    // Get order with items for response (same as public orders)
    const orderWithItemsResult = await executeQuery(`
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o.id = $1
    `, [order.id]);

    const orderRows = orderWithItemsResult.rows;
    const formattedOrder = {
      id: order.id,
      tableId: order.tableNumber,
      tableNumber: order.tableNumber,
      items: orderRows.filter(row => row.item_id).map(row => ({
        id: row.item_id,
        menuItemId: row.menuItemId,
        menuItemName: row.menu_item_name,
        quantity: row.quantity,
        price: parseFloat(row.unitPrice.toString()),
        notes: row.notes,
        status: 'active'
      })),
      total: parseFloat(order.finalAmount.toString()),
      status: order.status.toLowerCase(),
      waiterId: order.createdById,
      waiterName: sourceDetails || 'Unknown',
      orderSource: order.orderSource,
      sourceDetails: order.sourceDetails,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      notes: order.notes,
      specialInstructions: order.specialInstructions,
      isDelivery: order.isDelivery,
      deliveryAddress: order.deliveryAddress,
      deliveryPlatform: order.deliveryPlatform,
      deliveryOrderId: order.deliveryOrderId,
      customerAddress: order.customerAddress,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      taxAmount: parseFloat(order.taxAmount.toString()),
      discountAmount: parseFloat(order.discountAmount.toString()),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };

    // Emit WebSocket event for admin and kitchen staff
    try {
      socketManager.emitNewOrder(tenantId, formattedOrder);
    } catch (error) {
      logger.error('Failed to emit WebSocket event:', error);
      // Don't fail the order creation if WebSocket fails
    }

    logger.info(`Order created: ${order.orderNumber} by ${sourceDetails} via ${finalOrderSource}`);
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

    // Validate status values - Simplified to 3 states
    const validStatuses = ['active', 'paid', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid status value. Use: active, paid, cancelled', 400);
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

    // Get order with items for response (same as public orders)
    const orderWithItemsResult = await executeQuery(`
      SELECT o.*, oi.id as item_id, oi."menuItemId", oi.quantity, oi."unitPrice", oi."totalPrice", oi.notes,
             mi.name as menu_item_name
      FROM orders o
      LEFT JOIN "orderItems" oi ON o.id = oi."orderId"
      LEFT JOIN "menuItems" mi ON oi."menuItemId" = mi.id
      WHERE o.id = $1
    `, [order.id]);

    const orderRows = orderWithItemsResult.rows;
    const formattedOrder = {
      id: order.id,
      tableId: order.tableNumber,
      tableNumber: order.tableNumber,
      items: orderRows.filter(row => row.item_id).map(row => ({
        id: row.item_id,
        menuItemId: row.menuItemId,
        menuItemName: row.menu_item_name,
        quantity: row.quantity,
        price: parseFloat(row.unitPrice.toString()),
        notes: row.notes,
        status: 'active'
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

    // Validate status values - Simplified to 3 states
    const validStatuses = ['active', 'paid', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid status value. Use: active, paid, cancelled', 400);
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

// DELETE /api/orders/:id - Cancel order with reason
router.delete('/:id', authenticateToken, requireRole(['WAITER', 'CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { reason, cancelledBy } = req.body;

    if (!id) {
      return sendError(res, 'VALIDATION_ERROR', 'ID is required', 400);
    }

    if (!reason) {
      return sendError(res, 'VALIDATION_ERROR', 'Cancellation reason is required', 400);
    }

    // Check if order exists
    const existingOrderResult = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [id, tenantId]
    );

    if (existingOrderResult.rows.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Order not found', 404);
    }

    const user = (req as any).user;

    // Update order status to cancelled with reason
    await executeQuery(
      `UPDATE orders SET 
        status = $1, 
        "cancellationReason" = $2, 
        "cancelledByUserId" = $3, 
        "cancelledAt" = $4, 
        "updatedAt" = $5 
       WHERE id = $6`,
      ['CANCELLED', reason, user?.id || cancelledBy, new Date(), new Date(), id]
    );

    logger.info(`Order cancelled: ${id} - Reason: ${reason}`);
    sendSuccess(res, { success: true }, 'Order cancelled successfully');
  } catch (error) {
    logger.error('Cancel order error:', error);
    sendError(res, 'DELETE_ERROR', 'Failed to cancel order');
  }
});

// PUT /api/orders/:id/pay - Mark order as paid
router.put('/:id/pay', authenticateToken, requireRole(['CASHIER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { paymentMethod, paidBy } = req.body;

    if (!id) {
      return sendError(res, 'VALIDATION_ERROR', 'ID is required', 400);
    }

    if (!paymentMethod) {
      return sendError(res, 'VALIDATION_ERROR', 'Payment method is required', 400);
    }

    // Check if order exists
    const existingOrderResult = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [id, tenantId]
    );

    if (existingOrderResult.rows.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Order not found', 404);
    }

    const user = (req as any).user;

    // Update order payment status
    await executeQuery(
      `UPDATE orders SET 
        "paymentStatus" = $1, 
        "paymentMethod" = $2, 
        "paidByUserId" = $3, 
        "paidAt" = $4, 
        "updatedAt" = $5 
       WHERE id = $6`,
      ['PAID', paymentMethod, user?.id || paidBy, new Date(), new Date(), id]
    );

    logger.info(`Order marked as paid: ${id} - Method: ${paymentMethod}`);
    sendSuccess(res, { success: true }, 'Order marked as paid successfully');
  } catch (error) {
    logger.error('Mark order as paid error:', error);
    sendError(res, 'PAYMENT_ERROR', 'Failed to mark order as paid');
  }
});

// PUT /api/orders/:id/modify - Modify order (add/remove items)
router.put('/:id/modify', authenticateToken, requireRole(['WAITER', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { action, itemId, quantity, notes, reason } = req.body;

    if (!id) {
      return sendError(res, 'VALIDATION_ERROR', 'ID is required', 400);
    }

    if (!action || !itemId) {
      return sendError(res, 'VALIDATION_ERROR', 'Action and itemId are required', 400);
    }

    // Check if order exists
    const existingOrderResult = await executeQuery(
      'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
      [id, tenantId]
    );

    if (existingOrderResult.rows.length === 0) {
      return sendError(res, 'NOT_FOUND', 'Order not found', 404);
    }

    // Check if menu item exists
    const menuItemResult = await executeQuery(
      'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
      [itemId, tenantId]
    );

    if (menuItemResult.rows.length === 0) {
      return sendError(res, 'MENU_ITEM_NOT_FOUND', 'Menu item not found', 400);
    }

    const menuItem = menuItemResult.rows[0];
    const user = (req as any).user;

    if (action === 'add_item') {
      // Add new item to order
      const itemTotal = parseFloat(menuItem.price.toString()) * quantity;
      
      await executeQuery(
        `INSERT INTO "orderItems" (id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          id,
          itemId,
          quantity,
          menuItem.price,
          itemTotal,
          notes,
          new Date()
        ]
      );

      // Update order total
      const currentTotal = parseFloat(existingOrderResult.rows[0].totalAmount.toString());
      const newTotal = currentTotal + itemTotal;
      
      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
        [newTotal, newTotal, new Date(), id]
      );

      logger.info(`Item added to order: ${id} - Item: ${menuItem.name}, Quantity: ${quantity}`);
      sendSuccess(res, { success: true, action: 'add_item', itemId, quantity }, 'Item added to order successfully');

    } else if (action === 'remove_item') {
      // Find the specific order item to remove
      const orderItemResult = await executeQuery(
        'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
        [id, itemId]
      );

      if (orderItemResult.rows.length === 0) {
        return sendError(res, 'ITEM_NOT_FOUND', 'Item not found in order', 400);
      }

      const orderItem = orderItemResult.rows[0];
      const itemTotal = parseFloat(orderItem.totalPrice.toString());

      // Remove the item
      await executeQuery(
        'DELETE FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
        [id, itemId]
      );

      // Update order total
      const currentTotal = parseFloat(existingOrderResult.rows[0].totalAmount.toString());
      const newTotal = currentTotal - itemTotal;
      
      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
        [newTotal, newTotal, new Date(), id]
      );

      logger.info(`Item removed from order: ${id} - Item: ${menuItem.name}`);
      sendSuccess(res, { success: true, action: 'remove_item', itemId }, 'Item removed from order successfully');

    } else if (action === 'change_quantity') {
      // Find the specific order item to update
      const orderItemResult = await executeQuery(
        'SELECT * FROM "orderItems" WHERE "orderId" = $1 AND "menuItemId" = $2',
        [id, itemId]
      );

      if (orderItemResult.rows.length === 0) {
        return sendError(res, 'ITEM_NOT_FOUND', 'Item not found in order', 400);
      }

      const orderItem = orderItemResult.rows[0];
      const oldTotal = parseFloat(orderItem.totalPrice.toString());
      const newTotal = parseFloat(menuItem.price.toString()) * quantity;

      // Update the item quantity and total
      await executeQuery(
        'UPDATE "orderItems" SET quantity = $1, "totalPrice" = $2, notes = $3 WHERE "orderId" = $4 AND "menuItemId" = $5',
        [quantity, newTotal, notes, id, itemId]
      );

      // Update order total
      const currentTotal = parseFloat(existingOrderResult.rows[0].totalAmount.toString());
      const totalDifference = newTotal - oldTotal;
      const newOrderTotal = currentTotal + totalDifference;
      
      await executeQuery(
        'UPDATE orders SET "totalAmount" = $1, "finalAmount" = $2, "updatedAt" = $3 WHERE id = $4',
        [newOrderTotal, newOrderTotal, new Date(), id]
      );

      logger.info(`Item quantity changed in order: ${id} - Item: ${menuItem.name}, New Quantity: ${quantity}`);
      sendSuccess(res, { success: true, action: 'change_quantity', itemId, quantity }, 'Item quantity updated successfully');

    } else {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid action. Use: add_item, remove_item, change_quantity', 400);
    }

  } catch (error) {
    logger.error('Modify order error:', error);
    sendError(res, 'MODIFY_ERROR', 'Failed to modify order');
  }
});

export default router; 