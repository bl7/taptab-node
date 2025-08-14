import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { sendSuccess, sendError } from "../utils/response";
import { MenuService } from "../services/MenuService";
import { getTenantId } from "../middleware/tenant";

export class MenuController {
  /**
   * Create a new menu item
   */
  static async createMenuItem(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const menuItemData = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const menuItem = await MenuService.createMenuItem({
        ...menuItemData,
        tenantId,
      });

      logger.info(`Menu item created via controller: ${menuItem.id}`);
      return sendSuccess(
        res,
        { menuItem },
        "Menu item created successfully",
        201
      );
    } catch (error) {
      logger.error("MenuController.createMenuItem error:", error);
      return sendError(res, "CREATE_ERROR", "Failed to create menu item");
    }
  }

  /**
   * Get menu item by ID
   */
  static async getMenuItem(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { menuItemId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!menuItemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID is required",
          400
        );
      }

      const menuItem = await MenuService.getMenuItem(menuItemId, tenantId);

      return sendSuccess(res, { menuItem }, "Menu item retrieved successfully");
    } catch (error) {
      logger.error("MenuController.getMenuItem error:", error);
      return sendError(res, "NOT_FOUND", "Menu item not found", 404);
    }
  }

  /**
   * Update menu item
   */
  static async updateMenuItem(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { menuItemId } = req.params;
      const updates = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!menuItemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID is required",
          400
        );
      }

      const updatedMenuItem = await MenuService.updateMenuItem(
        menuItemId,
        tenantId,
        updates
      );

      return sendSuccess(
        res,
        { menuItem: updatedMenuItem },
        "Menu item updated successfully"
      );
    } catch (error) {
      logger.error("MenuController.updateMenuItem error:", error);
      return sendError(res, "UPDATE_ERROR", "Failed to update menu item");
    }
  }

  /**
   * Delete menu item
   */
  static async deleteMenuItem(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { menuItemId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!menuItemId) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Menu item ID is required",
          400
        );
      }

      const result = await MenuService.deleteMenuItem(menuItemId, tenantId);

      return sendSuccess(res, result, "Menu item deleted successfully");
    } catch (error) {
      logger.error("MenuController.deleteMenuItem error:", error);
      return sendError(res, "DELETE_ERROR", "Failed to delete menu item");
    }
  }

  /**
   * Get all menu items with filters
   */
  static async getMenuItems(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { categoryId, isActive, search, limit, offset } = req.query;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const filters: any = {};
      if (categoryId) filters.categoryId = categoryId as string;
      if (isActive !== undefined) filters.isActive = isActive === "true";
      if (search) filters.search = search as string;
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);

      const menuItems = await MenuService.getMenuItems(tenantId, filters);

      return sendSuccess(
        res,
        { menuItems },
        "Menu items retrieved successfully"
      );
    } catch (error) {
      logger.error("MenuController.getMenuItems error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch menu items");
    }
  }

  /**
   * Create a new menu category
   */
  static async createCategory(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const categoryData = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const category = await MenuService.createCategory({
        ...categoryData,
        tenantId,
      });

      logger.info(`Menu category created via controller: ${category.id}`);
      return sendSuccess(
        res,
        { category },
        "Menu category created successfully",
        201
      );
    } catch (error) {
      logger.error("MenuController.createCategory error:", error);
      return sendError(res, "CREATE_ERROR", "Failed to create menu category");
    }
  }

  /**
   * Get all menu categories
   */
  static async getCategories(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);
      const { isActive } = req.query;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const isActiveFilter =
        isActive !== undefined ? isActive === "true" : undefined;
      const categories = await MenuService.getCategories(
        tenantId,
        isActiveFilter
      );

      return sendSuccess(
        res,
        { categories },
        "Menu categories retrieved successfully"
      );
    } catch (error) {
      logger.error("MenuController.getCategories error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch menu categories");
    }
  }

  /**
   * Get public menu items (for customer-facing API)
   */
  static async getPublicMenuItems(req: Request, res: Response) {
    try {
      const tenantId = await getTenantId(req);

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const menuItems = await MenuService.getPublicMenuItems(tenantId);

      return sendSuccess(
        res,
        { menuItems },
        "Public menu items retrieved successfully"
      );
    } catch (error) {
      logger.error("MenuController.getPublicMenuItems error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch public menu items");
    }
  }
}
