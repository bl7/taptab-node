import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";

export interface CreateMenuItemData {
  name: string;
  description?: string;
  price: number;
  categoryId: string;
  tenantId: string;
  imageUrl?: string;
  isActive?: boolean;
  preparationTime?: number;
  allergens?: string[];
  tags?: string[];
}

export interface UpdateMenuItemData {
  name?: string;
  description?: string;
  price?: number;
  categoryId?: string;
  imageUrl?: string;
  isActive?: boolean;
  preparationTime?: number;
}

export interface CreateCategoryData {
  name: string;
  description?: string;
  tenantId: string;
  isActive?: boolean;
  sortOrder?: number;
}

export class MenuService {
  /**
   * Create a new menu item
   */
  static async createMenuItem(itemData: CreateMenuItemData) {
    const {
      name,
      description,
      price,
      categoryId,
      tenantId,
      imageUrl,
      isActive = true,
      preparationTime,
    } = itemData;

    // Validate required fields
    if (!name || !price || !categoryId || !tenantId) {
      throw new Error("Name, price, category ID, and tenant ID are required");
    }

    // Verify category exists and belongs to tenant
    const categoryCheck = await executeQuery(
      'SELECT id FROM "menuCategories" WHERE id = $1 AND "tenantId" = $2',
      [categoryId, tenantId]
    );

    if (categoryCheck.rows.length === 0) {
      throw new Error("Category not found or access denied");
    }

    // Generate menu item ID
    const menuItemId = `mi_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    // Create menu item
    const menuItemQuery = `
      INSERT INTO "menuItems" (
        id, name, description, price, "categoryId", "tenantId", "imageUrl", 
        "isActive", "preparationTime", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const now = new Date();
    const result = await executeQuery(menuItemQuery, [
      menuItemId,
      name,
      description || "",
      price,
      categoryId,
      tenantId,
      imageUrl || "",
      isActive,
      preparationTime || null,
      now,
      now,
    ]);

    const menuItem = result.rows[0];
    logger.info(`Menu item created: ${menuItemId} - ${name}`);
    return menuItem;
  }

  /**
   * Get menu item by ID
   */
  static async getMenuItem(menuItemId: string, tenantId: string) {
    const result = await executeQuery(
      'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
      [menuItemId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Menu item not found");
    }

    return result.rows[0];
  }

  /**
   * Update menu item
   */
  static async updateMenuItem(
    menuItemId: string,
    tenantId: string,
    updates: UpdateMenuItemData
  ) {
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }

    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }

    if (updates.price !== undefined) {
      updateFields.push(`price = $${paramIndex++}`);
      values.push(updates.price);
    }

    if (updates.categoryId !== undefined) {
      updateFields.push(`"categoryId" = $${paramIndex++}`);
      values.push(updates.categoryId);
    }

    if (updates.imageUrl !== undefined) {
      updateFields.push(`"imageUrl" = $${paramIndex++}`);
      values.push(updates.imageUrl);
    }

    if (updates.isActive !== undefined) {
      updateFields.push(`"isActive" = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    if (updates.preparationTime !== undefined) {
      updateFields.push(`"preparationTime" = $${paramIndex++}`);
      values.push(updates.preparationTime);
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    updateFields.push(`"updatedAt" = $${paramIndex++}`);
    values.push(new Date());

    // Add WHERE clause parameters
    values.push(menuItemId);
    values.push(tenantId);

    const updateQuery = `
      UPDATE "menuItems" 
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex++} AND "tenantId" = $${paramIndex++}
      RETURNING *
    `;

    const result = await executeQuery(updateQuery, values);

    if (result.rows.length === 0) {
      throw new Error("Menu item not found or access denied");
    }

    logger.info(`Menu item updated: ${menuItemId}`);
    return result.rows[0];
  }

  /**
   * Delete menu item
   */
  static async deleteMenuItem(menuItemId: string, tenantId: string) {
    // Check if item is used in any orders
    const orderCheck = await executeQuery(
      'SELECT COUNT(*) as count FROM "orderItems" WHERE "menuItemId" = $1',
      [menuItemId]
    );

    if (parseInt(orderCheck.rows[0].count) > 0) {
      throw new Error("Cannot delete menu item that has been ordered");
    }

    const result = await executeQuery(
      'DELETE FROM "menuItems" WHERE id = $1 AND "tenantId" = $2 RETURNING id',
      [menuItemId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Menu item not found or access denied");
    }

    logger.info(`Menu item deleted: ${menuItemId}`);
    return { success: true, menuItemId };
  }

  /**
   * Get all menu items for a tenant
   */
  static async getMenuItems(
    tenantId: string,
    filters: {
      categoryId?: string;
      isActive?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    let query = `
      SELECT mi.*, mc.name as category_name
      FROM "menuItems" mi
      LEFT JOIN "menuCategories" mc ON mi."categoryId" = mc.id
      WHERE mi."tenantId" = $1
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.categoryId) {
      query += ` AND mi."categoryId" = $${paramIndex++}`;
      values.push(filters.categoryId);
    }

    if (filters.isActive !== undefined) {
      query += ` AND mi."isActive" = $${paramIndex++}`;
      values.push(filters.isActive ? "true" : "false");
    }

    if (filters.search) {
      query += ` AND (mi.name ILIKE $${paramIndex++} OR mi.description ILIKE $${paramIndex++})`;
      const searchTerm = `%${filters.search}%`;
      values.push(searchTerm);
      values.push(searchTerm);
    }

    query += ` ORDER BY mc."sortOrder", mi.name`;

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit.toString());
    }

    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(filters.offset.toString());
    }

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Create a new menu category
   */
  static async createCategory(categoryData: CreateCategoryData) {
    const {
      name,
      description,
      tenantId,
      isActive = true,
      sortOrder = 0,
    } = categoryData;

    if (!name || !tenantId) {
      throw new Error("Name and tenant ID are required");
    }

    const categoryId = `mc_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    const query = `
      INSERT INTO "menuCategories" (
        id, name, description, "tenantId", "isActive", "sortOrder", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const now = new Date();
    const result = await executeQuery(query, [
      categoryId,
      name,
      description || "",
      tenantId,
      isActive,
      sortOrder,
      now,
      now,
    ]);

    const category = result.rows[0];
    logger.info(`Menu category created: ${categoryId} - ${name}`);
    return category;
  }

  /**
   * Get all menu categories for a tenant
   */
  static async getCategories(tenantId: string, isActive?: boolean) {
    let query = `
      SELECT mc.*, COUNT(mi.id) as item_count
      FROM "menuCategories" mc
      LEFT JOIN "menuItems" mi ON mc.id = mi."categoryId" AND mi."isActive" = true
      WHERE mc."tenantId" = $1
    `;

    const values = [tenantId];

    if (isActive !== undefined) {
      query += ` AND mc."isActive" = $2`;
      values.push(isActive ? "true" : "false");
    }

    query += ` GROUP BY mc.id ORDER BY mc."sortOrder", mc.name`;

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Get public menu items (for customer-facing API)
   */
  static async getPublicMenuItems(tenantId: string) {
    const query = `
      SELECT mi.*, mc.name as category_name, mc."sortOrder" as category_sort
      FROM "menuItems" mi
      LEFT JOIN "menuCategories" mc ON mi."categoryId" = mc.id
      WHERE mi."tenantId" = $1 
        AND mi."isActive" = true 
        AND mc."isActive" = true
      ORDER BY mc."sortOrder", mc.name, mi.name
    `;

    const result = await executeQuery(query, [tenantId]);
    return result.rows;
  }
}
