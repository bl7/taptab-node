import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId, tenantMiddleware } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/response';
import { executeQuery } from '../../utils/database';

const router = Router();

// ==================== DELIVEROO CONFIGURATION MANAGEMENT ====================

// GET /api/v1/deliveroo-config - Get Deliveroo configuration for current restaurant
router.get('/', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    
    const result = await executeQuery(
      'SELECT id, "restaurantId", "clientId", "isActive", "createdAt", "updatedAt" FROM "deliverooConfigs" WHERE "tenantId" = $1 AND "isActive" = true',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return sendSuccess(res, { config: null }, 'No Deliveroo configuration found');
    }

    // Don't return clientSecret for security
    const config = result.rows[0];
    sendSuccess(res, { config }, 'Deliveroo configuration fetched successfully');
  } catch (error) {
    logger.error('Fetch Deliveroo config error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch Deliveroo configuration');
  }
});

// POST /api/v1/deliveroo-config - Create/Update Deliveroo configuration
router.post('/', authenticateToken, requireRole(['TENANT_ADMIN']), tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { clientId, clientSecret, apiUrl, webhookSecret } = req.body;

    if (!clientId || !clientSecret) {
      return sendError(res, 'VALIDATION_ERROR', 'Client ID and Client Secret are required', 400);
    }

    // Check if config already exists
    const existingConfig = await executeQuery(
      'SELECT id FROM "deliverooConfigs" WHERE "tenantId" = $1',
      [tenantId]
    );

    if (existingConfig.rows.length > 0) {
      // Update existing config
      await executeQuery(
        `UPDATE "deliverooConfigs" SET 
          "clientId" = $1, "clientSecret" = $2, 
          "isActive" = true, "updatedAt" = $3
         WHERE "tenantId" = $4`,
        [clientId, clientSecret, new Date(), tenantId]
      );
    } else {
      // Create new config
      const configId = `deliveroo_config_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      await executeQuery(
        `INSERT INTO "deliverooConfigs" (
          id, "tenantId", "clientId", "clientSecret", 
          "isActive", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, true, $5, $6)`,
        [
          configId,
          tenantId,
          clientId,
          clientSecret,
          new Date(),
          new Date()
        ]
      );
    }

    sendSuccess(res, { 
      clientId
    }, 'Deliveroo configuration saved successfully');
  } catch (error) {
    logger.error('Save Deliveroo config error:', error);
    sendError(res, 'SAVE_ERROR', 'Failed to save Deliveroo configuration');
  }
});

// DELETE /api/v1/deliveroo-config - Deactivate Deliveroo configuration
router.delete('/', authenticateToken, requireRole(['TENANT_ADMIN']), tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    
    await executeQuery(
      'UPDATE "deliverooConfigs" SET "isActive" = false, "updatedAt" = $1 WHERE "tenantId" = $2',
      [new Date(), tenantId]
    );

    sendSuccess(res, { success: true }, 'Deliveroo configuration deactivated successfully');
  } catch (error) {
    logger.error('Deactivate Deliveroo config error:', error);
    sendError(res, 'DEACTIVATE_ERROR', 'Failed to deactivate Deliveroo configuration');
  }
});

// POST /api/v1/deliveroo-config/test - Test Deliveroo connection
router.post('/test', authenticateToken, requireRole(['TENANT_ADMIN', 'MANAGER']), tenantMiddleware, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    
    // Get config
    const configResult = await executeQuery(
      'SELECT * FROM "deliverooConfigs" WHERE "tenantId" = $1 AND "isActive" = true',
      [tenantId]
    );

    if (configResult.rows.length === 0) {
      return sendError(res, 'CONFIG_NOT_FOUND', 'No active Deliveroo configuration found', 404);
    }

    const config = configResult.rows[0];

    // Test Basic Authentication
    try {
      // Create Basic Auth credentials
      const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      
      // Test credential verification endpoint (sandbox)
      const apiUrl = 'https://api-sandbox.developers.deliveroo.com';
      const apiResponse = await fetch(`${apiUrl}/api/v1/auth/verify`, {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        }
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        throw new Error(`API call failed: ${apiResponse.status} - ${errorText}`);
      }

      sendSuccess(res, { 
        success: true,
        message: 'Deliveroo connection test successful',
        clientId: config.clientId
      }, 'Deliveroo connection test successful');
    } catch (error) {
      sendError(res, 'CONNECTION_ERROR', `Deliveroo connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } catch (error) {
    logger.error('Test Deliveroo connection error:', error);
    sendError(res, 'TEST_ERROR', 'Failed to test Deliveroo connection');
  }
});

export default router; 