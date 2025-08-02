import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger';
import { executeQuery } from '../../utils/database';

const router = Router();

// Verify token and get user info
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Token is required',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // 1. SIGNATURE VERIFICATION
    const decoded = jwt.verify(token, process.env['JWT_SECRET']!) as any;
    
    // 2. EXPIRATION CHECK
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

    // 3. TENANT VERIFICATION
    const tenantResult = await executeQuery(
      'SELECT id, name, slug, logo, colors, "isActive" FROM tenants WHERE id = $1 AND "isActive" = true',
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

    res.json({
      success: true,
      data: {
        user: {
          id: decoded.id,
          email: decoded.email,
          firstName: decoded.firstName,
          lastName: decoded.lastName,
          role: decoded.role,
          tenantId: decoded.tenantId,
          tenant: tenant,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid token',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router; 