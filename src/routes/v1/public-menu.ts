import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";
import { getPublicTenantId } from "../../middleware/tenant";
import { sendSuccess, sendError } from "../../utils/response";
import { findMany, executeQuery } from "../../utils/database";

const router = Router();

// ==================== PUBLIC MENU ITEMS (QR Ordering) ====================

// GET /api/v1/public/menu/items - Get all menu items (PUBLIC - no auth required)
router.get("/items", async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);
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

    // Fetch ingredients, allergens, and tags for each menu item (same as private route)
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
          quantity: parseFloat((ing.quantity || 0).toString()),
          unit: ing.unit,
          ingredient: {
            id: ing.ingredientId,
            name: ing.ingredient_name,
            description: ing.ingredient_description,
            unit: ing.ingredient_unit,
            costPerUnit: parseFloat((ing.costPerUnit || 0).toString()),
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
          SELECT mt.id, mt.name, mt.description, mt.color, mit.createdat as assignedAt
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
    logger.error("Get public menu items error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch menu items");
    }
  }
});

// GET /api/v1/public/menu/categories - Get all menu categories (PUBLIC - no auth required)
router.get("/categories", async (req: Request, res: Response) => {
  try {
    const tenantId = await getPublicTenantId(req);

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
    logger.error("Get public categories error:", error);
    if (
      error instanceof Error &&
      error.message.includes("Tenant identifier required")
    ) {
      sendError(
        res,
        "VALIDATION_ERROR",
        "Restaurant identifier required. Use X-Tenant-Slug header or tenant query parameter",
        400
      );
    } else if (
      error instanceof Error &&
      error.message.includes("Restaurant not found")
    ) {
      sendError(
        res,
        "TENANT_NOT_FOUND",
        "Restaurant not found or inactive",
        404
      );
    } else {
      sendError(res, "FETCH_ERROR", "Failed to fetch categories");
    }
  }
});

export default router;
