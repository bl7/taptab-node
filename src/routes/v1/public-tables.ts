import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getPublicTenantId } from '../../middleware/tenant';
import { sendSuccess, sendError } from '../../utils/response';
import { findMany } from '../../utils/database';

const router = Router();

// ==================== PUBLIC TABLES (QR Ordering) ====================

// GET /api/v1/public/tables - Get all tables (PUBLIC - no auth required)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);

    const tables = await findMany('tables', { "tenantId": tenantId }, '"number" ASC');

    const formattedTables = tables.map((table: any) => ({
      id: table.id,
      number: table.number,
      capacity: table.capacity,
      status: table.status,
      location: table.location,
      currentOrderId: table.currentOrderId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt
    }));

    sendSuccess(res, { tables: formattedTables });
  } catch (error) {
    logger.error('Get public tables error:', error);
    if (error instanceof Error && error.message.includes('Tenant identifier required')) {
      sendError(res, 'VALIDATION_ERROR', 'Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter', 400);
    } else if (error instanceof Error && error.message.includes('Restaurant not found')) {
      sendError(res, 'TENANT_NOT_FOUND', 'Restaurant not found or inactive', 404);
    } else {
      sendError(res, 'FETCH_ERROR', 'Failed to fetch tables');
    }
  }
});

export default router; 