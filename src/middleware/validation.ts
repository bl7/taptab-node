import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';

// Validation schemas
export const categoryValidation = [
  body('name').isLength({ min: 1, max: 100 }).trim(),
  body('sortOrder').optional().isInt({ min: 0 }),
];

export const menuItemValidation = [
  body('name').isLength({ min: 1, max: 200 }).trim(),
  body('description').optional().isLength({ max: 1000 }).trim(),
  body('price').isFloat({ min: 0 }),
  body('categoryId').notEmpty(),
];

export const statusValidation = [
  body('isActive').isBoolean(),
];

// Validation middleware
export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array(),
      },
      timestamp: new Date().toISOString(),
    });
  }
  next();
}; 