import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getPublicTenantId } from '../../middleware/tenant';
import { sendSuccess, sendError } from '../../utils/response';
import { findMany, executeQuery } from '../../utils/database';

const router = Router();

// ==================== PUBLIC MENU ITEMS (QR Ordering) ====================

// GET /api/v1/public/menu/items - Get all menu items (PUBLIC - no auth required)
router.get('/items', async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);
    const { category } = req.query;

    let query = `
      SELECT mi.*, c.name as category_name 
      FROM "menuItems" mi 
      LEFT JOIN categories c ON mi."categoryId" = c.id 
      WHERE mi."tenantId" = $1 AND mi."isActive" = true
    `;
    const values: any[] = [tenantId];

    if (category) {
      query += ` AND mi."categoryId" = $2`;
      values.push(category);
    }

    query += ` ORDER BY mi."sortOrder" ASC, mi.name ASC`;

    const result = await executeQuery(query, values);
    const items = result.rows;

    const formattedItems = items.map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: parseFloat(item.price.toString()),
      category: item.category_name,
      categoryId: item.categoryId,
      image: item.image,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));

    sendSuccess(res, { items: formattedItems });
  } catch (error) {
    logger.error('Get public menu items error:', error);
    if (error instanceof Error && error.message.includes('Tenant identifier required')) {
      sendError(res, 'VALIDATION_ERROR', 'Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter', 400);
    } else if (error instanceof Error && error.message.includes('Restaurant not found')) {
      sendError(res, 'TENANT_NOT_FOUND', 'Restaurant not found or inactive', 404);
    } else {
      sendError(res, 'FETCH_ERROR', 'Failed to fetch menu items');
    }
  }
});

// GET /api/v1/public/menu/categories - Get all menu categories (PUBLIC - no auth required)
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);

    const categories = await findMany('categories', { "tenantId": tenantId, "isActive": true }, '"sortOrder" ASC');

    const formattedCategories = categories.map((category: any) => ({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt
    }));

    sendSuccess(res, { categories: formattedCategories });
  } catch (error) {
    logger.error('Get public categories error:', error);
    if (error instanceof Error && error.message.includes('Tenant identifier required')) {
      sendError(res, 'VALIDATION_ERROR', 'Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter', 400);
    } else if (error instanceof Error && error.message.includes('Restaurant not found')) {
      sendError(res, 'TENANT_NOT_FOUND', 'Restaurant not found or inactive', 404);
    } else {
      sendError(res, 'FETCH_ERROR', 'Failed to fetch categories');
    }
  }
});

export default router; 