import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/response';
import { executeQuery } from '../../utils/database';
import { DeliverooService, DeliverooWebhookPayload } from '../../services/deliveroo';

const router = Router();

// ==================== DELIVEROO INTEGRATION ====================

// Helper function to get Deliveroo service instance
const getDeliverooService = (tenantId: string) => {
  return new DeliverooService(tenantId);
};

// ==================== WEBHOOK ENDPOINTS ====================

// POST /api/v1/deliveroo/webhook - Handle Deliveroo webhooks
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Extract webhook signature and GUID from headers
    const sequenceGuid = req.headers['x-deliveroo-sequence-guid'] as string;
    const signature = req.headers['x-deliveroo-hmac-sha256'] as string;
    
    if (!sequenceGuid || !signature) {
      return sendError(res, 'WEBHOOK_ERROR', 'Missing webhook signature headers', 400);
    }

    // Get webhook secret from environment or database
    const webhookSecret = process.env.DELIVEROO_WEBHOOK_SECRET || 'your-webhook-secret';
    
    // Prepare the signed payload (GUID + space + request body)
    const signedPayload = sequenceGuid + ' ' + JSON.stringify(req.body);
    
    // Calculate expected signature using HMAC-SHA256
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(signedPayload)
      .digest('hex');
    
    // Verify signature
    if (signature !== expectedSignature) {
      logger.error('Webhook signature verification failed');
      return sendError(res, 'WEBHOOK_ERROR', 'Invalid webhook signature', 401);
    }
    
    const payload: DeliverooWebhookPayload = req.body;
    
    // Get tenant ID from the order or webhook payload
    // This might need to be configured per restaurant
    const tenantId = process.env.DELIVEROO_TENANT_ID || 'default_tenant';
    
    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.processWebhook(payload);

    sendSuccess(res, { success: true }, 'Webhook processed successfully');
  } catch (error) {
    logger.error('Deliveroo webhook error:', error);
    sendError(res, 'WEBHOOK_ERROR', 'Failed to process webhook');
  }
});

// GET /api/v1/deliveroo/webhook/test - Test webhook endpoint
router.get('/webhook/test', async (req: Request, res: Response) => {
  try {
    sendSuccess(res, { 
      message: 'Webhook endpoint is accessible',
      url: '/api/v1/deliveroo/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Deliveroo-Sequence-Guid': 'required',
        'X-Deliveroo-Hmac-Sha256': 'required'
      }
    }, 'Webhook endpoint ready');
  } catch (error) {
    logger.error('Webhook test error:', error);
    sendError(res, 'TEST_ERROR', 'Failed to test webhook endpoint');
  }
});

// ==================== ORDER API ENDPOINTS ====================

// GET /api/v1/deliveroo/orders - Get orders from Deliveroo
router.get('/orders', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER', 'KITCHEN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status, limit } = req.query;
    
    const deliverooService = getDeliverooService(tenantId);
    const orders = await deliverooService.getOrders(status as string, parseInt(limit as string) || 50);
    
    sendSuccess(res, { orders }, 'Deliveroo orders fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo orders error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo orders');
  }
});

// GET /api/v1/deliveroo/orders/:orderId - Get specific order
router.get('/orders/:orderId', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER', 'KITCHEN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { orderId } = req.params;
    
    const deliverooService = getDeliverooService(tenantId);
    const order = await deliverooService.getOrder(orderId);
    
    sendSuccess(res, { order }, 'Deliveroo order fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo order error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo order');
  }
});

// PUT /api/v1/deliveroo/orders/:orderId/status - Update order status
router.put('/orders/:orderId/status', authenticateToken, requireRole(['KITCHEN', 'MANAGER', 'TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return sendError(res, 'VALIDATION_ERROR', 'Status is required', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.updateOrderStatus(orderId, status);

    // Update status in our database
    await executeQuery(
      'UPDATE orders SET status = $1, "updatedAt" = $2 WHERE "deliverooOrderId" = $3 AND "tenantId" = $4',
      [status, new Date(), orderId, tenantId]
    );

    sendSuccess(res, { 
      orderId,
      status,
      updatedAt: new Date()
    }, 'Deliveroo order status updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo order status error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo order status');
  }
});

// ==================== MENU API ENDPOINTS ====================

// GET /api/v1/deliveroo/menu/categories - Get menu categories
router.get('/menu/categories', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const deliverooService = getDeliverooService(tenantId);
    const categories = await deliverooService.getMenuCategories();
    
    sendSuccess(res, { categories }, 'Deliveroo menu categories fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo menu categories error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo menu categories');
  }
});

// POST /api/v1/deliveroo/menu/categories - Create menu category
router.post('/menu/categories', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { name, description, sort_order } = req.body;

    if (!name) {
      return sendError(res, 'VALIDATION_ERROR', 'Category name is required', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    const category = await deliverooService.createMenuCategory({
      name,
      description,
      sort_order: sort_order || 0
    });
    
    sendSuccess(res, { category }, 'Deliveroo menu category created successfully');
  } catch (error) {
    logger.error('Create Deliveroo menu category error:', error);
    sendError(res, 'CREATE_ERROR', 'Failed to create Deliveroo menu category');
  }
});

// PUT /api/v1/deliveroo/menu/categories/:categoryId - Update menu category
router.put('/menu/categories/:categoryId', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { categoryId } = req.params;
    const updateData = req.body;

    const deliverooService = getDeliverooService(tenantId);
    const category = await deliverooService.updateMenuCategory(categoryId, updateData);
    
    sendSuccess(res, { category }, 'Deliveroo menu category updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo menu category error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo menu category');
  }
});

// DELETE /api/v1/deliveroo/menu/categories/:categoryId - Delete menu category
router.delete('/menu/categories/:categoryId', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { categoryId } = req.params;

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.deleteMenuCategory(categoryId);
    
    sendSuccess(res, { success: true }, 'Deliveroo menu category deleted successfully');
  } catch (error) {
    logger.error('Delete Deliveroo menu category error:', error);
    sendError(res, 'DELETE_ERROR', 'Failed to delete Deliveroo menu category');
  }
});

// GET /api/v1/deliveroo/menu/items - Get menu items
router.get('/menu/items', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { categoryId } = req.query;
    
    const deliverooService = getDeliverooService(tenantId);
    const items = await deliverooService.getMenuItems(categoryId as string);
    
    sendSuccess(res, { items }, 'Deliveroo menu items fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo menu items error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo menu items');
  }
});

// POST /api/v1/deliveroo/menu/items - Create menu item
router.post('/menu/items', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { name, description, price, category_id, image_url, allergens, available, pos_id } = req.body;

    if (!name || !price || !category_id) {
      return sendError(res, 'VALIDATION_ERROR', 'Name, price, and category_id are required', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    const item = await deliverooService.createMenuItem({
      name,
      description,
      price: parseFloat(price),
      category_id,
      image_url,
      allergens: allergens || [],
      available: available !== false,
      pos_id
    });
    
    sendSuccess(res, { item }, 'Deliveroo menu item created successfully');
  } catch (error) {
    logger.error('Create Deliveroo menu item error:', error);
    sendError(res, 'CREATE_ERROR', 'Failed to create Deliveroo menu item');
  }
});

// PUT /api/v1/deliveroo/menu/items/:itemId - Update menu item
router.put('/menu/items/:itemId', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { itemId } = req.params;
    const updateData = req.body;

    const deliverooService = getDeliverooService(tenantId);
    const item = await deliverooService.updateMenuItem(itemId, updateData);
    
    sendSuccess(res, { item }, 'Deliveroo menu item updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo menu item error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo menu item');
  }
});

// DELETE /api/v1/deliveroo/menu/items/:itemId - Delete menu item
router.delete('/menu/items/:itemId', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { itemId } = req.params;

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.deleteMenuItem(itemId);
    
    sendSuccess(res, { success: true }, 'Deliveroo menu item deleted successfully');
  } catch (error) {
    logger.error('Delete Deliveroo menu item error:', error);
    sendError(res, 'DELETE_ERROR', 'Failed to delete Deliveroo menu item');
  }
});

// ==================== SITE API ENDPOINTS ====================

// GET /api/v1/deliveroo/site - Get site information
router.get('/site', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const deliverooService = getDeliverooService(tenantId);
    const site = await deliverooService.getSite();
    
    sendSuccess(res, { site }, 'Deliveroo site information fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo site error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo site information');
  }
});

// PUT /api/v1/deliveroo/site/status - Update site status
router.put('/site/status', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status } = req.body;

    if (!status || !['open', 'closed', 'busy'].includes(status)) {
      return sendError(res, 'VALIDATION_ERROR', 'Status must be open, closed, or busy', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.updateSiteStatus(status);
    
    sendSuccess(res, { status }, 'Deliveroo site status updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo site status error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo site status');
  }
});

// PUT /api/v1/deliveroo/site/opening-hours - Update opening hours
router.put('/site/opening-hours', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { opening_hours } = req.body;

    if (!opening_hours || !Array.isArray(opening_hours)) {
      return sendError(res, 'VALIDATION_ERROR', 'Opening hours array is required', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.updateOpeningHours(opening_hours);
    
    sendSuccess(res, { opening_hours }, 'Deliveroo opening hours updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo opening hours error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo opening hours');
  }
});

// PUT /api/v1/deliveroo/site/workload-mode - Update workload mode
router.put('/site/workload-mode', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { mode } = req.body;

    if (!mode) {
      return sendError(res, 'VALIDATION_ERROR', 'Workload mode is required', 400);
    }

    const deliverooService = getDeliverooService(tenantId);
    await deliverooService.updateWorkloadMode(mode);
    
    sendSuccess(res, { mode }, 'Deliveroo workload mode updated successfully');
  } catch (error) {
    logger.error('Update Deliveroo workload mode error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update Deliveroo workload mode');
  }
});

// ==================== SYNC ENDPOINTS ====================

// POST /api/v1/deliveroo/sync/orders - Sync orders from Deliveroo
router.post('/sync/orders', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { status } = req.body;
    
    const deliverooService = getDeliverooService(tenantId);
    const orders = await deliverooService.getOrders(status);
    
    // Process each order
    let synced = 0;
    for (const order of orders) {
      // Check if order already exists
      const existingOrder = await executeQuery(
        'SELECT * FROM orders WHERE "deliverooOrderId" = $1 AND "tenantId" = $2',
        [order.id, tenantId]
      );

      if (existingOrder.rows.length === 0) {
        // Create new order using the service
        await deliverooService['createOrder'](deliverooService['mapDeliverooOrder'](order));
        synced++;
      }
    }

    sendSuccess(res, { 
      synced,
      total: orders.length,
      orders: orders.map(o => ({ id: o.id, reference: o.reference }))
    }, `Synced ${synced} orders from Deliveroo`);
  } catch (error) {
    logger.error('Sync Deliveroo orders error:', error);
    sendError(res, 'SYNC_ERROR', 'Failed to sync Deliveroo orders');
  }
});

// POST /api/v1/deliveroo/sync/menu - Sync menu to Deliveroo
router.post('/sync/menu', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    
    // Get menu items from our database
    const menuResult = await executeQuery(
      `SELECT mi.*, mc.name as category_name 
       FROM "menuItems" mi 
       LEFT JOIN "menuCategories" mc ON mi."categoryId" = mc.id 
       WHERE mi."tenantId" = $1 AND mi."isActive" = true`,
      [tenantId]
    );

    const deliverooService = getDeliverooService(tenantId);
    
    // Sync categories first
    const categories = await deliverooService.getMenuCategories();
    const categoryMap = new Map(categories.map(c => [c.name, c.id]));
    
    // Sync items
    let synced = 0;
    for (const item of menuResult.rows) {
      try {
        // Find or create category
        let categoryId = categoryMap.get(item.category_name);
        if (!categoryId) {
          const newCategory = await deliverooService.createMenuCategory({
            name: item.category_name,
            sort_order: 0
          });
          categoryId = newCategory.id;
          categoryMap.set(item.category_name, categoryId);
        }

        // Create or update menu item
        await deliverooService.createMenuItem({
          name: item.name,
          description: item.description,
          price: parseFloat(item.price.toString()),
          category_id: categoryId,
          image_url: item.image,
          available: item.isActive,
          pos_id: item.id
        });
        synced++;
      } catch (error) {
        logger.error(`Failed to sync menu item ${item.name}:`, error);
      }
    }

    sendSuccess(res, { 
      synced,
      total: menuResult.rows.length
    }, `Synced ${synced} menu items to Deliveroo`);
  } catch (error) {
    logger.error('Sync menu to Deliveroo error:', error);
    sendError(res, 'SYNC_ERROR', 'Failed to sync menu to Deliveroo');
  }
});

export default router; 