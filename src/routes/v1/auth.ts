import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { logger } from "../../utils/logger";
import { executeQuery } from "../../utils/database";
import { sendSuccess, sendError } from "../../utils/response";

const router = Router();

// Login route - authenticate with email and PIN
router.post("/login", async (req, res) => {
  try {
    const { email, pin } = req.body;

    // Validate required fields
    if (!email || !pin) {
      return sendError(
        res,
        "VALIDATION_ERROR",
        "Email and PIN are required",
        400
      );
    }

    // Validate PIN format (6 digits)
    if (!/^\d{6}$/.test(pin)) {
      return sendError(
        res,
        "VALIDATION_ERROR",
        "PIN must be exactly 6 digits",
        400
      );
    }

    // Find user by email
    console.log("🔍 Searching for user with email:", email.toLowerCase());
    const userResult = await executeQuery(
      'SELECT u.*, t.name as "tenantName", t.slug as "tenantSlug", t.logo as "tenantLogo" FROM users u LEFT JOIN tenants t ON u."tenantId" = t.id WHERE u.email = $1 AND u."isActive" = true',
      [email.toLowerCase()]
    );

    console.log("📋 User query result:", userResult.rows.length, "rows found");

    if (userResult.rows.length === 0) {
      return sendError(res, "INVALID_CREDENTIALS", "Invalid email or PIN", 401);
    }

    const user = userResult.rows[0];
    console.log("👤 User found:", {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Verify PIN using bcrypt
    console.log("🔐 Attempting PIN verification...");
    console.log("📝 User password field exists:", !!user.password);

    const isPinValid = await bcrypt.compare(pin, user.password);
    console.log("🔐 PIN verification result:", isPinValid);

    if (!isPinValid) {
      return sendError(res, "INVALID_CREDENTIALS", "Invalid email or PIN", 401);
    }

    // Check if tenant is active
    if (!user.tenantId || !user.tenantName) {
      return sendError(
        res,
        "TENANT_INACTIVE",
        "User's tenant is not active",
        401
      );
    }

    // Generate access token (short-lived)
    const accessTokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: "access",
    };

    const accessToken = jwt.sign(
      accessTokenPayload,
      process.env["JWT_SECRET"]!,
      {
        expiresIn: "15m", // Access token expires in 15 minutes
      }
    );

    // Generate refresh token (long-lived)
    const refreshTokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: "refresh",
    };

    const refreshToken = jwt.sign(
      refreshTokenPayload,
      process.env["JWT_REFRESH_SECRET"]!,
      {
        expiresIn: "7d", // Refresh token expires in 7 days
      }
    );

    // Return success response with tokens and user info
    return sendSuccess(res, {
      accessToken,
      refreshToken,
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
        },
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    console.error("Login error details:", error);

    // Type guard to check if error has code property
    if (error && typeof error === "object" && "code" in error) {
      const errorWithCode = error as { code: string };
      if (
        errorWithCode.code === "ECONNREFUSED" ||
        errorWithCode.code === "ENOTFOUND"
      ) {
        return sendError(
          res,
          "DATABASE_ERROR",
          "Database connection failed",
          500
        );
      }
    }

    // Type guard to check if error has message property
    if (error && typeof error === "object" && "message" in error) {
      const errorWithMessage = error as { message: string };
      if (
        errorWithMessage.message &&
        errorWithMessage.message.includes("column") &&
        errorWithMessage.message.includes("does not exist")
      ) {
        return sendError(
          res,
          "DATABASE_ERROR",
          "Database schema issue - password column not found",
          500
        );
      }
    }

    return sendError(res, "LOGIN_ERROR", "An error occurred during login", 500);
  }
});

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

    // Check if it's an access token
    if (decoded.type !== "access") {
      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_TOKEN_TYPE",
          message: "Invalid token type",
        },
        timestamp: new Date().toISOString(),
      });
    }

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

// Refresh token route
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return sendError(
        res,
        "REFRESH_TOKEN_REQUIRED",
        "Refresh token is required",
        400
      );
    }

    // Verify refresh token
    let decoded: any;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env["JWT_REFRESH_SECRET"]!
      ) as any;
    } catch (jwtError: any) {
      return sendError(
        res,
        "INVALID_REFRESH_TOKEN",
        "Invalid or expired refresh token",
        401
      );
    }

    // Check if it's a refresh token
    if (decoded.type !== "refresh") {
      return sendError(res, "INVALID_TOKEN_TYPE", "Invalid token type", 401);
    }

    // Check if user still exists and is active
    const userResult = await executeQuery(
      'SELECT u.*, t.name as "tenantName", t.slug as "tenantSlug", t.logo as "tenantLogo" FROM users u LEFT JOIN tenants t ON u."tenantId" = t.id WHERE u.id = $1 AND u."isActive" = true',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return sendError(
        res,
        "USER_NOT_FOUND",
        "User not found or inactive",
        401
      );
    }

    const user = userResult.rows[0];

    // Check if tenant is active
    if (!user.tenantId || !user.tenantName) {
      return sendError(
        res,
        "TENANT_INACTIVE",
        "User's tenant is not active",
        401
      );
    }

    // Generate new access token
    const accessTokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: "access",
    };

    const newAccessToken = jwt.sign(
      accessTokenPayload,
      process.env["JWT_SECRET"]!,
      {
        expiresIn: "15m", // Access token expires in 15 minutes
      }
    );

    // Return new access token
    return sendSuccess(res, {
      accessToken: newAccessToken,
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
        },
      },
    });
  } catch (error) {
    logger.error("Refresh token error:", error);
    return sendError(
      res,
      "REFRESH_ERROR",
      "An error occurred during token refresh",
      500
    );
  }
});

// Logout route
router.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return sendError(
        res,
        "REFRESH_TOKEN_REQUIRED",
        "Refresh token is required",
        400
      );
    }

    // Verify refresh token to get user info
    let decoded: any;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env["JWT_REFRESH_SECRET"]!
      ) as any;
    } catch (jwtError: any) {
      // Even if token is invalid, we consider logout successful
      return sendSuccess(res, {
        message: "Logged out successfully",
      });
    }

    // In a production system, you might want to:
    // 1. Store refresh tokens in a database/Redis
    // 2. Add the refresh token to a blacklist
    // 3. Invalidate all refresh tokens for the user

    logger.info(`User ${decoded.email} logged out successfully`);

    return sendSuccess(res, {
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout error:", error);
    return sendError(
      res,
      "LOGOUT_ERROR",
      "An error occurred during logout",
      500
    );
  }
});

export default router;
