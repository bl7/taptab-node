import { Router, Request, Response } from "express";
import { executeQuery } from "../../utils/database";
import { sendSuccess, sendError } from "../../utils/response";
import { logger } from "../../utils/logger";

const router = Router();

// =====================================================
// GET /api/v1/menu-item-tags/:menuItemId - Get tags for a menu item
// =====================================================
router.get("/:menuItemId", async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params;
    const tenantId = (req as any).user.tenantId;

    // First verify the menu item exists and belongs to the tenant
    const menuItemQuery = `
      SELECT id FROM "menuItems" 
      WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true
    `;
    const menuItemResult = await executeQuery(menuItemQuery, [
      menuItemId,
      tenantId,
    ]);

    if (menuItemResult.rows.length === 0) {
      return sendError(res, "NOT_FOUND", "Menu item not found", 404);
    }

    // Get assigned tags for the menu item
    const tagsQuery = `
      SELECT mt.id, mt.name, mt.description, mt.color, mit.createdAt as assignedAt
      FROM "menuItemTags" mit
      JOIN menuTags mt ON mit."tagId" = mt.id
      WHERE mit."menuItemId" = $1 AND mt.isActive = true
      ORDER BY mt.name ASC
    `;
    const result = await executeQuery(tagsQuery, [menuItemId]);

    const tags = result.rows.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      assignedAt: tag.assignedAt,
    }));

    sendSuccess(res, { tags });
  } catch (error) {
    logger.error("Get menu item tags error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch menu item tags");
  }
});

// =====================================================
// POST /api/v1/menu-item-tags/:menuItemId - Assign tag to menu item
// =====================================================
router.post("/:menuItemId", async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params;
    const { tagId } = req.body;
    const tenantId = (req as any).user.tenantId;

    // Validation
    if (!tagId) {
      return sendError(res, "VALIDATION_ERROR", "Tag ID is required", 400);
    }

    // Verify the menu item exists and belongs to the tenant
    const menuItemQuery = `
      SELECT id FROM "menuItems" 
      WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true
    `;
    const menuItemResult = await executeQuery(menuItemQuery, [
      menuItemId,
      tenantId,
    ]);

    if (menuItemResult.rows.length === 0) {
      return sendError(res, "NOT_FOUND", "Menu item not found", 404);
    }

    // Verify the tag exists and is active
    const tagQuery = `SELECT id FROM menuTags WHERE id = $1 AND isActive = true`;
    const tagResult = await executeQuery(tagQuery, [tagId]);

    if (tagResult.rows.length === 0) {
      return sendError(res, "NOT_FOUND", "Tag not found", 404);
    }

    // Check if assignment already exists
    const existingQuery = `
      SELECT id FROM "menuItemTags" 
      WHERE "menuItemId" = $1 AND "tagId" = $2
    `;
    const existingResult = await executeQuery(existingQuery, [
      menuItemId,
      tagId,
    ]);

    if (existingResult.rows.length > 0) {
      return sendError(
        res,
        "DUPLICATE_ERROR",
        "Tag is already assigned to this menu item",
        409
      );
    }

    // Create the assignment
    const assignmentId = `mit_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const insertQuery = `
      INSERT INTO "menuItemTags" (id, "menuItemId", "tagId", createdAt)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const result = await executeQuery(insertQuery, [
      assignmentId,
      menuItemId,
      tagId,
    ]);

    // Get the full tag details for response
    const fullTagQuery = `
      SELECT mt.id, mt.name, mt.description, mt.color, mit.createdAt as assignedAt
      FROM "menuItemTags" mit
      JOIN menuTags mt ON mit."tagId" = mt.id
      WHERE mit.id = $1
    `;
    const fullTagResult = await executeQuery(fullTagQuery, [assignmentId]);
    const assignedTag = fullTagResult.rows[0];

    const formattedTag = {
      id: assignedTag.id,
      name: assignedTag.name,
      description: assignedTag.description,
      color: assignedTag.color,
      assignedAt: assignedTag.assignedAt,
    };

    logger.info(
      `Tag assigned: ${assignedTag.name} to menu item: ${menuItemId}`
    );
    sendSuccess(res, { tag: formattedTag }, "Tag assigned successfully", 201);
  } catch (error) {
    logger.error("Assign menu item tag error:", error);
    sendError(res, "ASSIGNMENT_ERROR", "Failed to assign tag to menu item");
  }
});

// =====================================================
// DELETE /api/v1/menu-item-tags/:menuItemId/:tagId - Remove tag from menu item
// =====================================================
router.delete("/:menuItemId/:tagId", async (req: Request, res: Response) => {
  try {
    const { menuItemId, tagId } = req.params;
    const tenantId = (req as any).user.tenantId;

    // Verify the menu item exists and belongs to the tenant
    const menuItemQuery = `
      SELECT id FROM "menuItems" 
      WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true
    `;
    const menuItemResult = await executeQuery(menuItemQuery, [
      menuItemId,
      tenantId,
    ]);

    if (menuItemResult.rows.length === 0) {
      return sendError(res, "NOT_FOUND", "Menu item not found", 404);
    }

    // Remove the tag assignment
    const deleteQuery = `
      DELETE FROM "menuItemTags" 
      WHERE "menuItemId" = $1 AND "tagId" = $2
    `;
    const result = await executeQuery(deleteQuery, [menuItemId, tagId]);

    if (result.rowCount === 0) {
      return sendError(res, "NOT_FOUND", "Tag assignment not found", 404);
    }

    logger.info(`Tag removed from menu item: ${menuItemId}`);
    sendSuccess(res, null, "Tag removed successfully");
  } catch (error) {
    logger.error("Remove menu item tag error:", error);
    sendError(res, "REMOVAL_ERROR", "Failed to remove tag from menu item");
  }
});

export default router;
