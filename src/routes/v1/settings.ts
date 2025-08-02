import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getTenantId } from '../../middleware/tenant';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { sendSuccess, sendError, sendNotFound } from '../../utils/response';
import { findById, updateWithCheck, executeQuery } from '../../utils/database';

const router = Router();

// ==================== SETTINGS ====================

// GET /api/settings - Get restaurant settings
router.get('/', authenticateToken, requireRole(['TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

    // Try to get settings from settings table first
    const settingsResult = await executeQuery(
      'SELECT * FROM settings WHERE "tenantId" = $1 LIMIT 1',
      [tenantId]
    );

    if (settingsResult.rows.length > 0) {
      const settings = settingsResult.rows[0];
      sendSuccess(res, {
        restaurantName: settings.restaurantName,
        address: settings.address || '',
        phone: settings.phone || '',
        email: settings.email || '',
        taxRate: parseFloat(settings.taxRate.toString()),
        currency: settings.currency,
        timezone: settings.timezone
      });
    } else {
      // Fallback to tenant table
      const tenantResult = await executeQuery(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return sendNotFound(res, 'Tenant not found');
      }

      const tenant = tenantResult.rows[0];
      const settings = {
        restaurantName: tenant.name,
        address: tenant.address || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        taxRate: 0,
        currency: 'USD',
        timezone: 'UTC'
      };

      sendSuccess(res, settings);
    }

    sendSuccess(res, settings);
  } catch (error) {
    logger.error('Get settings error:', error);
    sendError(res, 'FETCH_ERROR', 'Failed to fetch settings');
  }
});

// PUT /api/settings - Update restaurant settings
router.put('/', authenticateToken, requireRole(['TENANT_ADMIN']), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { restaurantName, address, phone, email, taxRate, currency, timezone } = req.body;

    if (!restaurantName) {
      return sendError(res, 'VALIDATION_ERROR', 'Restaurant name is required', 400);
    }

    // Check if settings exist for this tenant
    const existingSettingsResult = await executeQuery(
      'SELECT id FROM settings WHERE "tenantId" = $1',
      [tenantId]
    );

    if (existingSettingsResult.rows.length > 0) {
      // Update existing settings
      const settingsId = existingSettingsResult.rows[0].id;
      const updateData = {
        restaurantName,
        address,
        phone,
        email,
        taxRate: taxRate || 0,
        currency: currency || 'USD',
        timezone: timezone || 'UTC',
        updatedAt: new Date()
      };

      const updatedSettings = await updateWithCheck('settings', settingsId, updateData, tenantId);

      const settings = {
        restaurantName: updatedSettings.restaurantName,
        address: updatedSettings.address || '',
        phone: updatedSettings.phone || '',
        email: updatedSettings.email || '',
        taxRate: parseFloat(updatedSettings.taxRate.toString()),
        currency: updatedSettings.currency,
        timezone: updatedSettings.timezone
      };

      logger.info(`Settings updated for tenant: ${tenantId}`);
      sendSuccess(res, { settings }, 'Settings updated successfully');
    } else {
      // Create new settings
      const settingsData = {
        id: `settings_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        restaurantName,
        address,
        phone,
        email,
        taxRate: taxRate || 0,
        currency: currency || 'USD',
        timezone: timezone || 'UTC',
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const newSettings = await createWithCheck('settings', settingsData, 'restaurantName', restaurantName, tenantId);

      const settings = {
        restaurantName: newSettings.restaurantName,
        address: newSettings.address || '',
        phone: newSettings.phone || '',
        email: newSettings.email || '',
        taxRate: parseFloat(newSettings.taxRate.toString()),
        currency: newSettings.currency,
        timezone: newSettings.timezone
      };

      logger.info(`Settings created for tenant: ${tenantId}`);
      sendSuccess(res, { settings }, 'Settings created successfully');
    }
  } catch (error) {
    logger.error('Update settings error:', error);
    sendError(res, 'UPDATE_ERROR', 'Failed to update settings');
  }
});

export default router; 