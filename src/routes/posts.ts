import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query, getRow, getRows } from '../utils/database';
import { logger } from '../utils/logger';

const router = Router();

// Create a new post
router.post('/', [
  authenticateToken,
  body('title').isLength({ min: 1, max: 200 }).trim(),
  body('content').isLength({ min: 1, max: 10000 }).trim(),
  body('published').optional().isBoolean()
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

    const { title, content, published = false } = req.body;

    const result = await query(
      `INSERT INTO posts (title, content, published, "authorId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, title, content, published, "authorId", "createdAt", "updatedAt"`,
      [title, content, published, req.user!.id]
    );

    const post = result.rows[0];

    logger.info(`Post created: ${post.id} by ${req.user!.email}`);

    res.status(201).json({
      status: 'success',
      message: 'Post created successfully',
      data: { post }
    });
  } catch (error) {
    logger.error('Create post error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get all posts with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const published = req.query.published === 'true';

    let whereClause = '';
    let params: any[] = [];
    
    if (published !== undefined) {
      whereClause = 'WHERE published = $1';
      params = [published];
    }

    const posts = await getRows(
      `SELECT p.id, p.title, p.content, p.published, p."createdAt", p."updatedAt",
              u.id as "authorId", u.username as "authorUsername", u."firstName" as "authorFirstName", u."lastName" as "authorLastName"
       FROM posts p
       JOIN users u ON p."authorId" = u.id
       ${whereClause}
       ORDER BY p."createdAt" DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const countResult = await getRow(
      `SELECT COUNT(*) as total FROM posts ${whereClause}`,
      params
    );
    const total = parseInt(countResult.total);

    res.json({
      status: 'success',
      data: {
        posts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get posts error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get post by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const post = await getRow(
      `SELECT p.id, p.title, p.content, p.published, p."createdAt", p."updatedAt",
              u.id as "authorId", u.username as "authorUsername", u."firstName" as "authorFirstName", u."lastName" as "authorLastName"
       FROM posts p
       JOIN users u ON p."authorId" = u.id
       WHERE p.id = $1`,
      [id]
    );

    if (!post) {
      return res.status(404).json({
        status: 'error',
        message: 'Post not found'
      });
    }

    res.json({
      status: 'success',
      data: { post }
    });
  } catch (error) {
    logger.error('Get post by ID error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update post
router.put('/:id', [
  authenticateToken,
  body('title').optional().isLength({ min: 1, max: 200 }).trim(),
  body('content').optional().isLength({ min: 1, max: 10000 }).trim(),
  body('published').optional().isBoolean()
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

    const { id } = req.params;
    const { title, content, published } = req.body;

    // Check if post exists and user is the author
    const existingPost = await getRow(
      'SELECT id, "authorId" FROM posts WHERE id = $1',
      [id]
    );

    if (!existingPost) {
      return res.status(404).json({
        status: 'error',
        message: 'Post not found'
      });
    }

    if (existingPost.authorId !== req.user!.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to update this post'
      });
    }

    const result = await query(
      `UPDATE posts 
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           published = COALESCE($3, published),
           "updatedAt" = NOW()
       WHERE id = $4
       RETURNING id, title, content, published, "authorId", "createdAt", "updatedAt"`,
      [title, content, published, id]
    );

    const post = result.rows[0];

    logger.info(`Post updated: ${post.id} by ${req.user!.email}`);

    res.json({
      status: 'success',
      message: 'Post updated successfully',
      data: { post }
    });
  } catch (error) {
    logger.error('Update post error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Delete post
router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if post exists and user is the author
    const existingPost = await getRow(
      'SELECT id, "authorId" FROM posts WHERE id = $1',
      [id]
    );

    if (!existingPost) {
      return res.status(404).json({
        status: 'error',
        message: 'Post not found'
      });
    }

    if (existingPost.authorId !== req.user!.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to delete this post'
      });
    }

    await query('DELETE FROM posts WHERE id = $1', [id]);

    logger.info(`Post deleted: ${id} by ${req.user!.email}`);

    res.json({
      status: 'success',
      message: 'Post deleted successfully'
    });
  } catch (error) {
    logger.error('Delete post error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get user's posts
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const posts = await getRows(
      `SELECT p.id, p.title, p.content, p.published, p."createdAt", p."updatedAt",
              u.id as "authorId", u.username as "authorUsername", u."firstName" as "authorFirstName", u."lastName" as "authorLastName"
       FROM posts p
       JOIN users u ON p."authorId" = u.id
       WHERE p."authorId" = $1
       ORDER BY p."createdAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await getRow(
      'SELECT COUNT(*) as total FROM posts WHERE "authorId" = $1',
      [userId]
    );
    const total = parseInt(countResult.total);

    res.json({
      status: 'success',
      data: {
        posts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Get user posts error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

export default router; 