import { Router } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../../utils/logger";
import { executeQuery } from "../../utils/database";

const router = Router();

// Verify token and get user info
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: "TOKEN_REQUIRED",
          message: "Token is required",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env["JWT_SECRET"]!) as any;

    // Get user details
    const userResult = await executeQuery(
      'SELECT u.*, t.name as "tenantName", t.slug as "tenantSlug", t.logo as "tenantLogo", t.colors as "tenantColors" FROM users u LEFT JOIN tenants t ON u."tenantId" = t.id WHERE u.id = $1 AND u."isActive" = true',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
        },
        timestamp: new Date().toISOString(),
      });
    }

    const user = userResult.rows[0];

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          tenant: {
            id: user.tenantId,
            name: user.tenantName,
            slug: user.tenantSlug,
            logo: user.tenantLogo,
            colors: user.tenantColors,
          },
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Token verification error:", error);
    return res.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid or expired token",
      },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
