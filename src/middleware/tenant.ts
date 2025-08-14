import { Request, Response, NextFunction } from "express";
import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";

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
    // Get tenant from header or query parameter
    const tenantSlug =
      (req.headers["x-tenant-slug"] as string) ||
      (req.query["tenant"] as string);

    if (!tenantSlug) {
      return res.status(400).json({
        success: false,
        error: {
          code: "TENANT_REQUIRED",
          message: "Tenant slug is required",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Get tenant from database
    const tenantResult = await executeQuery(
      'SELECT * FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: "TENANT_NOT_FOUND",
          message: "Tenant not found",
        },
        timestamp: new Date().toISOString(),
      });
    }

    const tenant = tenantResult.rows[0];
    req.tenant = tenant;
    return next();
  } catch (error) {
    logger.error("Tenant middleware error:", error);
    return res.status(500).json({
      success: false,
      error: {
        code: "TENANT_ERROR",
        message: "Failed to process tenant",
      },
      timestamp: new Date().toISOString(),
    });
  }
};

// Helper function to get tenant ID from request
export const getTenantId = (req: Request): string => {
  // Try to get tenant ID from user context first
  const userTenantId = (req as any).user?.tenantId;
  if (userTenantId) {
    return userTenantId;
  }

  // Fallback to tenant object
  const tenant = (req as any).tenant;
  if (tenant?.id) {
    return tenant.id;
  }

  // Last resort - try to get from headers or query
  const tenantSlug =
    (req.headers["x-tenant-slug"] as string) || (req.query["tenant"] as string);
  if (tenantSlug) {
    return tenantSlug; // This should be the tenant ID in most cases
  }

  throw new Error("Tenant ID not found in request");
};

// Helper function to get tenant from request
export const getTenant = (req: TenantRequest): any => {
  return req.tenant!;
};

// New function for public endpoints - detect tenant from header or query
export const getPublicTenantId = async (
  req: Request
): Promise<string | null> => {
  try {
    // Get tenant from header or query parameter
    const tenantSlug =
      (req.headers["x-tenant-slug"] as string) ||
      (req.query["tenant"] as string);

    if (!tenantSlug) {
      return null;
    }

    // Query the database to get the tenant ID from the slug
    const tenantResult = await executeQuery(
      'SELECT id FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      logger.error(`Tenant not found with slug: ${tenantSlug}`);
      return null;
    }

    const tenantId = tenantResult.rows[0].id;
    logger.info(`Found tenant ID ${tenantId} for slug ${tenantSlug}`);
    return tenantId;
  } catch (error) {
    logger.error("Get public tenant ID error:", error);
    return null;
  }
};

// Helper function to get public tenant info
export const getPublicTenant = async (req: Request): Promise<any> => {
  try {
    const tenantSlug =
      (req.headers["x-tenant-slug"] as string) ||
      (req.query["tenant"] as string);

    if (!tenantSlug) {
      throw new Error("Tenant identifier required");
    }

    const tenantResult = await executeQuery(
      'SELECT * FROM tenants WHERE slug = $1 AND "isActive" = true',
      [tenantSlug]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Restaurant not found or inactive");
    }

    return tenantResult.rows[0];
  } catch (error) {
    logger.error("Public tenant info error:", error);
    throw error;
  }
};
