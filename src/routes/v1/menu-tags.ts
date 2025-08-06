import { Router, Request, Response } from "express";
import { executeQuery } from "../../utils/database";
import { sendSuccess, sendError } from "../../utils/response";
import { logger } from "../../utils/logger";

const router = Router();

// =====================================================
// GET /api/v1/menu-tags - Get all available menu tags
// =====================================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `SELECT * FROM menuTags WHERE isActive = true`;
    let countQuery = `SELECT COUNT(*) FROM menuTags WHERE isActive = true`;
    const values: any[] = [];
    let paramIndex = 1;

    // Add search functionality
    if (search) {
      const searchCondition = ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      query += searchCondition;
      countQuery += searchCondition;
      values.push(`%${search}%`);
      paramIndex++;
    }

    // Add pagination
    query += ` ORDER BY name ASC LIMIT $${paramIndex} OFFSET $${
      paramIndex + 1
    }`;
    values.push(Number(limit), offset);

    // Execute queries
    const [result, countResult] = await Promise.all([
      executeQuery(query, values),
      executeQuery(countQuery, values.slice(0, -2)), // Remove limit and offset for count
    ]);

    const tags = result.rows.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      isActive: tag.isActive,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    }));

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / Number(limit));

    sendSuccess(res, {
      tags,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
        hasNext: Number(page) < totalPages,
        hasPrev: Number(page) > 1,
      },
    });
  } catch (error) {
    logger.error("Get menu tags error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch menu tags");
  }
});

// =====================================================
// GET /api/v1/menu-tags/:id - Get specific menu tag
// =====================================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const query = `SELECT * FROM menuTags WHERE id = $1 AND isActive = true`;
    const result = await executeQuery(query, [id]);

    if (result.rows.length === 0) {
      return sendError(res, "NOT_FOUND", "Menu tag not found", 404);
    }

    const tag = result.rows[0];
    const formattedTag = {
      id: tag.id,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      isActive: tag.isActive,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };

    sendSuccess(res, { tag: formattedTag });
  } catch (error) {
    logger.error("Get menu tag error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch menu tag");
  }
});

export default router;
