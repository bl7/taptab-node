import { Request, Response, NextFunction } from 'express';
import { executeQuery } from '../utils/database';
import { logger } from '../utils/logger';

export interface TenantRequest extends Request {
  tenantId?: string;
  tenant?: any;
}

export const tenantMiddleware = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get tenant ID from user context (set by auth middleware)
    const tenantId = (req as any).user?.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'Tenant ID is required',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Verify tenant exists and is active
    const tenantResult = await executeQuery(
      'SELECT * FROM tenants WHERE id = $1 AND "isActive" = true',
      [tenantId]
    );
    const tenant = tenantResult.rows[0];

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Tenant not found or inactive',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Add tenant info to request
    req.tenantId = tenantId;
    req.tenant = tenant;

    next();
  } catch (error) {
    logger.error('Tenant middleware error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TENANT_MIDDLEWARE_ERROR',
        message: 'Internal server error',
      },
      timestamp: new Date().toISOString(),
    });
  }
};

// Helper function to get tenant ID from request
export const getTenantId = (req: TenantRequest): string => {
  return req.tenantId!;
};

// Helper function to get tenant from request
export const getTenant = (req: TenantRequest): any => {
  return req.tenant!;
};

// New function for public endpoints - detect tenant from header or query
export const getPublicTenantId = async (req: Request): Promise<string> => {
  try {
    // Try header first, then query parameter
    const tenantSlug = (req.headers['x-tenant-slug'] as string) || (req.query.tenant as string);
    
    if (!tenantSlug) {
      throw new Error('Tenant identifier required (X-Tenant-Slug header or tenant query parameter)');
    }

    // Get tenant by slug
    const tenantResult = await executeQuery(
      'SELECT id FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('Restaurant not found or inactive');
    }

    return tenantResult.rows[0].id;
  } catch (error) {
    logger.error('Public tenant detection error:', error);
    throw error;
  }
};

// Helper function to get public tenant info
export const getPublicTenant = async (req: Request): Promise<any> => {
  try {
    const tenantSlug = (req.headers['x-tenant-slug'] as string) || (req.query.tenant as string);
    
    if (!tenantSlug) {
      throw new Error('Tenant identifier required');
    }

    const tenantResult = await executeQuery(
      'SELECT * FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('Restaurant not found or inactive');
    }

    return tenantResult.rows[0];
  } catch (error) {
    logger.error('Public tenant info error:', error);
    throw error;
  }
}; 