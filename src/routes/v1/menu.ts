import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getTenantId, getPublicTenantId } from "../../middleware/tenant";
import { authenticateToken, requireRole } from "../../middleware/auth";
import { sendSuccess, sendError } from "../../utils/response";
import {
  findMany,
  findById,
  createWithCheck,
  updateWithCheck,
  deleteWithCheck,
  executeQuery,
} from "../../utils/database";

const router = Router();

// ==================== MENU ITEMS ====================

// GET /api/menu/items - Get all menu items (AUTHENTICATED)
router.get("/items", authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { category } = req.query;

    let query = `
      SELECT mi.*, c.name as category_name 
      FROM "menuItems" mi 
      LEFT JOIN categories c ON mi."categoryId" = c.id 
      WHERE mi."tenantId" = $1 AND mi."isActive" = true
    `;
    const values: any[] = [tenantId];

    if (category) {
      query += ` AND mi."categoryId" = $2`;
      values.push(category);
    }

    query += ` ORDER BY mi."sortOrder" ASC, mi.name ASC`;

    const result = await executeQuery(query, values);
    const items = result.rows;

    // Fetch ingredients and allergens for each menu item
    const formattedItems = await Promise.all(
      items.map(async (item: any) => {
        // Get ingredients for this menu item
        const ingredientsQuery = `
        SELECT mii.*, i.name as ingredient_name, i.description as ingredient_description, 
               i.unit as ingredient_unit, i.costPerUnit
        FROM "menuItemIngredients" mii
        JOIN ingredients i ON mii."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
      `;
        const ingredientsResult = await executeQuery(ingredientsQuery, [
          item.id,
        ]);
        const ingredients = ingredientsResult.rows.map((ing: any) => ({
          id: ing.id,
          ingredientId: ing.ingredientId,
          quantity: parseFloat(ing.quantity.toString()),
          unit: ing.unit,
          ingredient: {
            id: ing.ingredientId,
            name: ing.ingredient_name,
            description: ing.ingredient_description,
            unit: ing.ingredient_unit,
            costPerUnit: parseFloat(ing.costPerUnit.toString()),
          },
        }));

        // Get allergens for this menu item (auto-calculated from ingredients)
        const allergensQuery = `
        SELECT DISTINCT a.id, a.name, a.description, a.severity, a.isStandard,
               ia."ingredientId", i.name as ingredient_name
        FROM allergens a
        JOIN "ingredientAllergens" ia ON a.id = ia."allergenId"
        JOIN "menuItemIngredients" mii ON ia."ingredientId" = mii."ingredientId"
        JOIN ingredients i ON ia."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
        ORDER BY a.isStandard DESC, a.name ASC
      `;
        const allergensResult = await executeQuery(allergensQuery, [item.id]);

        // Group allergens by allergen and collect sources
        const allergenMap = new Map();
        allergensResult.rows.forEach((allergen: any) => {
          if (!allergenMap.has(allergen.id)) {
            allergenMap.set(allergen.id, {
              id: allergen.id,
              name: allergen.name,
              description: allergen.description,
              severity: allergen.severity,
              isStandard: allergen.isStandard,
              sources: [],
            });
          }
          allergenMap.get(allergen.id).sources.push({
            ingredientId: allergen.ingredientId,
            ingredientName: allergen.ingredient_name,
          });
        });
        const allergens = Array.from(allergenMap.values());

        // Get tags for this menu item
        const tagsQuery = `
          SELECT mt.id, mt.name, mt.description, mt.color, mit.createdAt as assignedAt
          FROM "menuItemTags" mit
          JOIN menuTags mt ON mit."tagId" = mt.id
          WHERE mit."menuItemId" = $1 AND mt.isActive = true
          ORDER BY mt.name ASC
        `;
        const tagsResult = await executeQuery(tagsQuery, [item.id]);
        const tags = tagsResult.rows.map((tag: any) => ({
          id: tag.id,
          name: tag.name,
          description: tag.description,
          color: tag.color,
          assignedAt: tag.assignedAt,
        }));

        return {
          id: item.id,
          name: item.name,
          description: item.description,
          price: parseFloat(item.price.toString()),
          category: item.category_name,
          categoryId: item.categoryId,
          image: item.image,
          isActive: item.isActive,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          ingredients: ingredients,
          allergens: allergens,
          tags: tags,
        };
      })
    );

    sendSuccess(res, { items: formattedItems });
  } catch (error) {
    logger.error("Get menu items error:", error);
    sendError(res, "FETCH_ERROR", "Failed to fetch menu items");
  }
});

// POST /api/menu/items - Create new menu item
router.post(
  "/items",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const {
        name,
        description,
        price,
        categoryId,
        image,
        ingredients = [],
        tags = [],
      } = req.body;

      // Validate required fields
      if (!name || !price) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Name and price are required",
          400
        );
      }

      // Verify category exists if provided
      if (categoryId) {
        const categoryResult = await executeQuery(
          'SELECT id FROM categories WHERE id = $1 AND "tenantId" = $2',
          [categoryId, tenantId]
        );

        if (categoryResult.rows.length === 0) {
          return sendError(
            res,
            "CATEGORY_NOT_FOUND",
            "Category not found",
            400
          );
        }
      }

      // Validate ingredients if provided
      if (ingredients && ingredients.length > 0) {
        for (const ingredient of ingredients) {
          if (!ingredient.ingredientId || !ingredient.quantity) {
            return sendError(
              res,
              "VALIDATION_ERROR",
              "Each ingredient must have ingredientId and quantity",
              400
            );
          }

          // Verify ingredient exists and belongs to tenant
          const ingredientResult = await executeQuery(
            'SELECT id FROM ingredients WHERE id = $1 AND "tenantId" = $2',
            [ingredient.ingredientId, tenantId]
          );

          if (ingredientResult.rows.length === 0) {
            return sendError(
              res,
              "INGREDIENT_NOT_FOUND",
              `Ingredient with ID ${ingredient.ingredientId} not found`,
              400
            );
          }
        }
      }

      const itemData = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name,
        description,
        price,
        categoryId: categoryId || null,
        tenantId,
        image,
        sortOrder: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const item = await createWithCheck(
        "menuItems",
        itemData,
        "name",
        name,
        tenantId
      );

      // Create ingredient relationships if provided
      if (ingredients && ingredients.length > 0) {
        for (const ingredient of ingredients) {
          const menuItemIngredientData = {
            id: `mii_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            menuItemId: item.id,
            ingredientId: ingredient.ingredientId,
            quantity: ingredient.quantity,
            unit: ingredient.unit || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await executeQuery(
            `INSERT INTO "menuItemIngredients" (id, "menuItemId", "ingredientId", quantity, unit, "createdAt", "updatedAt") 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              menuItemIngredientData.id,
              menuItemIngredientData.menuItemId,
              menuItemIngredientData.ingredientId,
              menuItemIngredientData.quantity,
              menuItemIngredientData.unit,
              menuItemIngredientData.createdAt,
              menuItemIngredientData.updatedAt,
            ]
          );
        }
      }

      // Validate and create tag relationships if provided
      if (tags && tags.length > 0) {
        // Validate each tag exists and is active
        for (const tagId of tags) {
          if (!tagId || typeof tagId !== "string") {
            return sendError(
              res,
              "VALIDATION_ERROR",
              "Each tag must be a valid tag ID",
              400
            );
          }

          // Verify tag exists and is active
          const tagResult = await executeQuery(
            "SELECT id FROM menuTags WHERE id = $1 AND isActive = true",
            [tagId]
          );

          if (tagResult.rows.length === 0) {
            return sendError(
              res,
              "TAG_NOT_FOUND",
              `Tag with ID ${tagId} not found`,
              400
            );
          }
        }

        // Create tag assignments
        for (const tagId of tags) {
          const menuItemTagData = {
            id: `mit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            menuItemId: item.id,
            tagId: tagId,
            createdAt: new Date(),
          };

          await executeQuery(
            `INSERT INTO "menuItemTags" (id, "menuItemId", "tagId", "createdAt") 
             VALUES ($1, $2, $3, $4)`,
            [
              menuItemTagData.id,
              menuItemTagData.menuItemId,
              menuItemTagData.tagId,
              menuItemTagData.createdAt,
            ]
          );
        }
      }

      // Get category name for response if categoryId exists
      let categoryName = "";
      if (item.categoryId) {
        const categoryNameResult = await executeQuery(
          "SELECT name FROM categories WHERE id = $1",
          [item.categoryId]
        );
        categoryName = categoryNameResult.rows[0]?.name || "";
      }

      // Get ingredients for response
      const ingredientsQuery = `
        SELECT mii.*, i.name as ingredient_name, i.description as ingredient_description, 
               i.unit as ingredient_unit, i.costPerUnit
        FROM "menuItemIngredients" mii
        JOIN ingredients i ON mii."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
      `;
      const ingredientsResult = await executeQuery(ingredientsQuery, [item.id]);
      const menuItemIngredients = ingredientsResult.rows.map((ing: any) => ({
        id: ing.id,
        ingredientId: ing.ingredientId,
        quantity: parseFloat(ing.quantity.toString()),
        unit: ing.unit,
        ingredient: {
          id: ing.ingredientId,
          name: ing.ingredient_name,
          description: ing.ingredient_description,
          unit: ing.ingredient_unit,
          costPerUnit: parseFloat(ing.costPerUnit.toString()),
        },
      }));

      // Get allergens for response
      const allergensQuery = `
        SELECT DISTINCT a.id, a.name, a.description, a.severity, a.isStandard,
               ia."ingredientId", i.name as ingredient_name
        FROM allergens a
        JOIN "ingredientAllergens" ia ON a.id = ia."allergenId"
        JOIN "menuItemIngredients" mii ON ia."ingredientId" = mii."ingredientId"
        JOIN ingredients i ON ia."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
        ORDER BY a.isStandard DESC, a.name ASC
      `;
      const allergensResult = await executeQuery(allergensQuery, [item.id]);

      const allergenMap = new Map();
      allergensResult.rows.forEach((allergen: any) => {
        if (!allergenMap.has(allergen.id)) {
          allergenMap.set(allergen.id, {
            id: allergen.id,
            name: allergen.name,
            description: allergen.description,
            severity: allergen.severity,
            isStandard: allergen.isStandard,
            sources: [],
          });
        }
        allergenMap.get(allergen.id).sources.push({
          ingredientId: allergen.ingredientId,
          ingredientName: allergen.ingredient_name,
        });
      });
      const allergens = Array.from(allergenMap.values());

      // Get tags for response
      const tagsQuery = `
        SELECT mt.id, mt.name, mt.description, mt.color, mit.createdAt as assignedAt
        FROM "menuItemTags" mit
        JOIN menuTags mt ON mit."tagId" = mt.id
        WHERE mit."menuItemId" = $1 AND mt.isActive = true
        ORDER BY mt.name ASC
      `;
      const tagsResult = await executeQuery(tagsQuery, [item.id]);
      const menuItemTags = tagsResult.rows.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        description: tag.description,
        color: tag.color,
        assignedAt: tag.assignedAt,
      }));

      const formattedItem = {
        id: item.id,
        name: item.name,
        description: item.description,
        price: parseFloat(item.price.toString()),
        category: categoryName,
        categoryId: item.categoryId,
        image: item.image,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ingredients: menuItemIngredients,
        allergens: allergens,
        tags: menuItemTags,
      };

      logger.info(`Menu item created: ${item.name}`);
      sendSuccess(
        res,
        { item: formattedItem },
        "Menu item created successfully",
        201
      );
    } catch (error) {
      logger.error("Create menu item error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create menu item");
    }
  }
);

// PUT /api/menu/items/:id - Update menu item
router.put(
  "/items/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const {
        name,
        description,
        price,
        categoryId,
        image,
        isActive,
        ingredients,
        tags,
      } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Check if item exists and get it
      const existingItem = await findById("menuItems", id, tenantId);

      // Verify category if being changed
      if (categoryId) {
        const categoryResult = await executeQuery(
          'SELECT id FROM categories WHERE id = $1 AND "tenantId" = $2',
          [categoryId, tenantId]
        );

        if (categoryResult.rows.length === 0) {
          return sendError(
            res,
            "CATEGORY_NOT_FOUND",
            "Category not found",
            400
          );
        }
      }

      // Validate ingredients if provided
      if (ingredients && ingredients.length > 0) {
        for (const ingredient of ingredients) {
          if (!ingredient.ingredientId || !ingredient.quantity) {
            return sendError(
              res,
              "VALIDATION_ERROR",
              "Each ingredient must have ingredientId and quantity",
              400
            );
          }

          // Verify ingredient exists and belongs to tenant
          const ingredientResult = await executeQuery(
            'SELECT id FROM ingredients WHERE id = $1 AND "tenantId" = $2',
            [ingredient.ingredientId, tenantId]
          );

          if (ingredientResult.rows.length === 0) {
            return sendError(
              res,
              "INGREDIENT_NOT_FOUND",
              `Ingredient with ID ${ingredient.ingredientId} not found`,
              400
            );
          }
        }
      }

      const updateData: any = {
        updatedAt: new Date(),
      };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = price;
      if (categoryId !== undefined) updateData.categoryId = categoryId;
      if (image !== undefined) updateData.image = image;
      if (isActive !== undefined) updateData.isActive = isActive;

      const item = await updateWithCheck("menuItems", id, updateData, tenantId);

      // Update ingredients if provided
      if (ingredients !== undefined) {
        // Delete existing ingredient relationships
        await executeQuery(
          'DELETE FROM "menuItemIngredients" WHERE "menuItemId" = $1',
          [id]
        );

        // Create new ingredient relationships
        if (ingredients && ingredients.length > 0) {
          for (const ingredient of ingredients) {
            const menuItemIngredientData = {
              id: `mii_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 5)}`,
              menuItemId: id,
              ingredientId: ingredient.ingredientId,
              quantity: ingredient.quantity,
              unit: ingredient.unit || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await executeQuery(
              `INSERT INTO "menuItemIngredients" (id, "menuItemId", "ingredientId", quantity, unit, "createdAt", "updatedAt") 
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                menuItemIngredientData.id,
                menuItemIngredientData.menuItemId,
                menuItemIngredientData.ingredientId,
                menuItemIngredientData.quantity,
                menuItemIngredientData.unit,
                menuItemIngredientData.createdAt,
                menuItemIngredientData.updatedAt,
              ]
            );
          }
        }
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Delete existing tag relationships
        await executeQuery(
          'DELETE FROM "menuItemTags" WHERE "menuItemId" = $1',
          [id]
        );

        // Create new tag relationships
        if (tags && tags.length > 0) {
          // Validate each tag exists and is active
          for (const tagId of tags) {
            if (!tagId || typeof tagId !== "string") {
              return sendError(
                res,
                "VALIDATION_ERROR",
                "Each tag must be a valid tag ID",
                400
              );
            }

            // Verify tag exists and is active
            const tagResult = await executeQuery(
              "SELECT id FROM menuTags WHERE id = $1 AND isActive = true",
              [tagId]
            );

            if (tagResult.rows.length === 0) {
              return sendError(
                res,
                "TAG_NOT_FOUND",
                `Tag with ID ${tagId} not found`,
                400
              );
            }
          }

          // Create tag assignments
          for (const tagId of tags) {
            const menuItemTagData = {
              id: `mit_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 5)}`,
              menuItemId: id,
              tagId: tagId,
              createdAt: new Date(),
            };

            await executeQuery(
              `INSERT INTO "menuItemTags" (id, "menuItemId", "tagId", "createdAt") 
               VALUES ($1, $2, $3, $4)`,
              [
                menuItemTagData.id,
                menuItemTagData.menuItemId,
                menuItemTagData.tagId,
                menuItemTagData.createdAt,
              ]
            );
          }
        }
      }

      // Get category name for response
      const categoryNameResult = await executeQuery(
        "SELECT name FROM categories WHERE id = $1",
        [item.categoryId]
      );

      // Get ingredients for response
      const ingredientsQuery = `
        SELECT mii.*, i.name as ingredient_name, i.description as ingredient_description, 
               i.unit as ingredient_unit, i.costPerUnit
        FROM "menuItemIngredients" mii
        JOIN ingredients i ON mii."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
      `;
      const ingredientsResult = await executeQuery(ingredientsQuery, [id]);
      const menuItemIngredients = ingredientsResult.rows.map((ing: any) => ({
        id: ing.id,
        ingredientId: ing.ingredientId,
        quantity: parseFloat(ing.quantity.toString()),
        unit: ing.unit,
        ingredient: {
          id: ing.ingredientId,
          name: ing.ingredient_name,
          description: ing.ingredient_description,
          unit: ing.ingredient_unit,
          costPerUnit: parseFloat(ing.costPerUnit.toString()),
        },
      }));

      // Get allergens for response
      const allergensQuery = `
        SELECT DISTINCT a.id, a.name, a.description, a.severity, a.isStandard,
               ia."ingredientId", i.name as ingredient_name
        FROM allergens a
        JOIN "ingredientAllergens" ia ON a.id = ia."allergenId"
        JOIN "menuItemIngredients" mii ON ia."ingredientId" = mii."ingredientId"
        JOIN ingredients i ON ia."ingredientId" = i.id
        WHERE mii."menuItemId" = $1
        ORDER BY a.isStandard DESC, a.name ASC
      `;
      const allergensResult = await executeQuery(allergensQuery, [id]);

      const allergenMap = new Map();
      allergensResult.rows.forEach((allergen: any) => {
        if (!allergenMap.has(allergen.id)) {
          allergenMap.set(allergen.id, {
            id: allergen.id,
            name: allergen.name,
            description: allergen.description,
            severity: allergen.severity,
            isStandard: allergen.isStandard,
            sources: [],
          });
        }
        allergenMap.get(allergen.id).sources.push({
          ingredientId: allergen.ingredientId,
          ingredientName: allergen.ingredient_name,
        });
      });
      const allergens = Array.from(allergenMap.values());

      // Get tags for response
      const tagsQuery = `
        SELECT mt.id, mt.name, mt.description, mt.color, mit.createdAt as assignedAt
        FROM "menuItemTags" mit
        JOIN menuTags mt ON mit."tagId" = mt.id
        WHERE mit."menuItemId" = $1 AND mt.isActive = true
        ORDER BY mt.name ASC
      `;
      const tagsResult = await executeQuery(tagsQuery, [id]);
      const menuItemTags = tagsResult.rows.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        description: tag.description,
        color: tag.color,
        assignedAt: tag.assignedAt,
      }));

      const formattedItem = {
        id: item.id,
        name: item.name,
        description: item.description,
        price: parseFloat(item.price.toString()),
        category: categoryNameResult.rows[0]?.name || "",
        categoryId: item.categoryId,
        image: item.image,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ingredients: menuItemIngredients,
        allergens: allergens,
        tags: menuItemTags,
      };

      logger.info(`Menu item updated: ${item.name}`);
      sendSuccess(
        res,
        { item: formattedItem },
        "Menu item updated successfully"
      );
    } catch (error) {
      logger.error("Update menu item error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update menu item");
    }
  }
);

// DELETE /api/menu/items/:id - Delete menu item
router.delete(
  "/items/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Check if item exists and delete
      await deleteWithCheck("menuItems", id, tenantId);

      logger.info(`Menu item deleted: ${id}`);
      sendSuccess(res, { success: true }, "Menu item deleted successfully");
    } catch (error) {
      logger.error("Delete menu item error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete menu item");
    }
  }
);

// ==================== CATEGORIES ====================

// GET /api/menu/categories - Get all menu categories (AUTHENTICATED)
router.get(
  "/categories",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);

      const categories = await findMany(
        "categories",
        { tenantId: tenantId, isActive: true },
        '"sortOrder" ASC'
      );

      const formattedCategories = categories.map((category: any) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      }));

      sendSuccess(res, { categories: formattedCategories });
    } catch (error) {
      logger.error("Get categories error:", error);
      sendError(res, "FETCH_ERROR", "Failed to fetch categories");
    }
  }
);

// POST /api/menu/categories - Create new category
router.post(
  "/categories",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { name, sortOrder = 0 } = req.body;

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      const categoryData = {
        id: `cat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name,
        tenantId,
        sortOrder,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const category = await createWithCheck(
        "categories",
        categoryData,
        "name",
        name,
        tenantId
      );

      const formattedCategory = {
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      };

      logger.info(`Category created: ${category.name}`);
      sendSuccess(
        res,
        { category: formattedCategory },
        "Category created successfully",
        201
      );
    } catch (error) {
      logger.error("Create category error:", error);
      sendError(res, "CREATE_ERROR", "Failed to create category");
    }
  }
);

// PUT /api/menu/categories/:id - Update category
router.put(
  "/categories/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;
      const { name, sortOrder, isActive } = req.body;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      if (!name) {
        return sendError(res, "VALIDATION_ERROR", "Name is required", 400);
      }

      const updateData = {
        name,
        sortOrder: sortOrder || 0,
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      };

      const category = await updateWithCheck(
        "categories",
        id,
        updateData,
        tenantId
      );

      const formattedCategory = {
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      };

      logger.info(`Category updated: ${category.name}`);
      sendSuccess(
        res,
        { category: formattedCategory },
        "Category updated successfully"
      );
    } catch (error) {
      logger.error("Update category error:", error);
      sendError(res, "UPDATE_ERROR", "Failed to update category");
    }
  }
);

// DELETE /api/menu/categories/:id - Delete category
router.delete(
  "/categories/:id",
  authenticateToken,
  requireRole(["TENANT_ADMIN", "MANAGER"]),
  async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      if (!id) {
        return sendError(res, "VALIDATION_ERROR", "ID is required", 400);
      }

      // Check if category exists and delete
      await deleteWithCheck("categories", id, tenantId);

      logger.info(`Category deleted: ${id}`);
      sendSuccess(res, { success: true }, "Category deleted successfully");
    } catch (error) {
      logger.error("Delete category error:", error);
      sendError(res, "DELETE_ERROR", "Failed to delete category");
    }
  }
);

export default router;
