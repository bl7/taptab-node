import { Router, Request, Response } from "express";
import { param, validationResult } from "express-validator";
import { logger } from "../../utils/logger";
import { sendSuccess, sendError } from "../../utils/response";
import { executeQuery } from "../../utils/database";

const router = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      "VALIDATION_ERROR",
      "Invalid request data",
      400,
      errors.array()
    );
  }
  next();
};

// GET /api/v1/public/tenant-info/{tenantSlug} - PUBLIC (no auth required)
router.get(
  "/tenant-info/:tenantSlug",
  [param("tenantSlug").notEmpty().withMessage("Tenant slug is required")],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { tenantSlug } = req.params;

      logger.info(`🔍 GET /api/v1/public/tenant-info/${tenantSlug} called`);
      logger.info(`📝 Request params:`, req.params);
      logger.info(`📝 Request headers:`, req.headers);

      // First, let's test if the database connection works
      logger.info(`🧪 Testing database connection...`);
      const testResult = await executeQuery("SELECT 1 as test");
      logger.info(`✅ Database connection test successful:`, testResult.rows);

      // Query to get tenant information by slug
      logger.info(`🔍 Querying for tenant with slug: ${tenantSlug}`);
      const result = await executeQuery(
        `SELECT 
          id as "tenantId",
          name,
          slug,
          logo,
          "primaryColor",
          "secondaryColor",
          address,
          phone,
          email,
          "isActive",
          "createdAt",
          "updatedAt"
        FROM tenants 
        WHERE slug = $1 AND "isActive" = true`,
        [tenantSlug]
      );

      logger.info(`📊 Query result:`, {
        rowCount: result.rows.length,
        rows: result.rows,
      });

      if (result.rows.length === 0) {
        logger.error(`❌ Tenant not found with slug: ${tenantSlug}`);
        return sendError(res, "NOT_FOUND", "Tenant not found", 404);
      }

      const tenantInfo = result.rows[0];
      logger.info(
        `✅ Tenant info found for slug ${tenantSlug}: ${tenantInfo.tenantId}`
      );

      sendSuccess(res, tenantInfo, "Tenant information retrieved successfully");
    } catch (error: any) {
      logger.error("❌ Error getting tenant info:", error);
      logger.error("❌ Error details:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
      sendError(
        res,
        "TENANT_INFO_ERROR",
        "Failed to get tenant information",
        500
      );
    }
  }
);

// Test endpoint to verify the route is working
router.get("/test", async (_req: Request, res: Response) => {
  logger.info("🧪 Test endpoint called");
  sendSuccess(res, { message: "Test endpoint working" }, "Test successful");
});

export default router;
