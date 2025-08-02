import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { executeQuery } from '../utils/database';

// Define UserRole enum locally since we're not using Prisma
enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  WAITER = 'WAITER',
  KITCHEN = 'KITCHEN',
  READONLY = 'READONLY'
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: string;
    tenantId: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. TOKEN EXTRACTION
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN_PROVIDED',
          message: 'No token provided',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // 2. SIGNATURE VERIFICATION
    console.log('=== JWT DEBUG ===');
    console.log('JWT_SECRET:', process.env['JWT_SECRET']);
    console.log('Token received:', token);
    
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env['JWT_SECRET']!) as any;
      console.log('✅ Token verification successful');
      console.log('Decoded token payload:', JSON.stringify(decoded, null, 2));
    } catch (jwtError) {
      console.log('❌ JWT verification failed:', jwtError.message);
      console.log('JWT Error details:', jwtError);
      throw jwtError;
    }

    // 3. EXPIRATION CHECK
    if (Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // 4. USER VERIFICATION - Check if user exists in users table
    const userResult = await executeQuery(
      'SELECT * FROM users WHERE id = $1 AND "isActive" = true',
      [decoded.id]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found or inactive',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // 5. TENANT VERIFICATION
    const tenantResult = await executeQuery(
      'SELECT * FROM tenants WHERE id = $1 AND "isActive" = true',
      [decoded.tenantId]
    );
    const tenant = tenantResult.rows[0];

    if (!tenant) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Tenant not found or inactive',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Add user info to request (from database)
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token',
        },
        timestamp: new Date().toISOString(),
      });
    }

    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'Internal server error',
      },
      timestamp: new Date().toISOString(),
    });
  }
};

// Role-based access control middleware
export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Insufficient permissions for this operation',
        },
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

// Super admin only middleware
export const requireSuperAdmin = requireRole(['SUPER_ADMIN']);

// Tenant admin or higher middleware
export const requireTenantAdmin = requireRole([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
]);

// Manager or higher middleware
export const requireManager = requireRole([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'MANAGER',
]);

// Staff member or higher middleware
export const requireStaff = requireRole([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
]);

// Tenant access control middleware
export const requireTenantAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      },
      timestamp: new Date().toISOString(),
    });
  }

  const targetTenantId = (req.params as any).tenantId || req.body.tenantId;

  if (req.user.role === 'SUPER_ADMIN') {
    return next(); // Super admin can access all tenants
  }

  if (req.user.tenantId !== targetTenantId) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: 'Access denied to this tenant',
      },
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

// Helper function to get user from request
export const getUser = (req: AuthRequest) => {
  return req.user!;
};

// Helper function to check if user has role
export const hasRole = (req: AuthRequest, role: string): boolean => {
  return req.user?.role === role;
};

// Helper function to check if user has any of the roles
export const hasAnyRole = (req: AuthRequest, roles: string[]): boolean => {
  return roles.includes(req.user?.role!);
}; 