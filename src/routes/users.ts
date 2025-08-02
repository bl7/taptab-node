import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, getRow, getRows } from '../utils/database';
import { logger } from '../utils/logger';

const router = Router();

// Get current user profile
router.get('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await getRow(
      `SELECT id, email, username, "firstName", "lastName", "isActive", "createdAt", "updatedAt"
       FROM users WHERE id = $1`,
      [req.user!.id]
    );

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.json({
      status: 'success',
      data: { user }
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', [
  authenticateToken,
  body('firstName').optional().trim(),
  body('lastName').optional().trim()
], async (req: AuthRequest, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { firstName, lastName } = req.body;

    const result = await query(
      `UPDATE users 
       SET "firstName" = COALESCE($1, "firstName"), 
           "lastName" = COALESCE($2, "lastName"), 
           "updatedAt" = NOW()
       WHERE id = $3
       RETURNING id, email, username, "firstName", "lastName", "isActive", "createdAt", "updatedAt"`,
      [firstName, lastName, req.user!.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    logger.info(`User profile updated: ${user.email}`);

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get all users (admin only - simplified for demo)
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const users = await getRows(
      `SELECT id, email, username, "firstName", "lastName", "isActive", "createdAt"
       FROM users 
       ORDER BY "createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await getRow('SELECT COUNT(*) as total FROM users');
    const total = parseInt(countResult.total);

    res.json({
      status: 'success',
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const user = await getRow(
      `SELECT id, email, username, "firstName", "lastName", "isActive", "createdAt", "updatedAt"
       FROM users WHERE id = $1`,
      [id]
    );

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.json({
      status: 'success',
      data: { user }
    });
  } catch (error) {
    logger.error('Get user by ID error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

export default router; 