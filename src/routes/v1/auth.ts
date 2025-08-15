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
        expiresIn: "8h", // Access token expires in 8 hours (typical shift length)
      }
    );

    // Log token creation details for debugging
    const decodedToken = jwt.decode(accessToken) as any;
    const tokenCreatedAt = new Date(decodedToken.iat * 1000);
    const tokenExpiresAt = new Date(decodedToken.exp * 1000);

    logger.info(`🔑 Access token created at: ${tokenCreatedAt.toISOString()}`);
    logger.info(`⏰ Access token expires at: ${tokenExpiresAt.toISOString()}`);
    logger.info(
      `⏱️ Token lifetime: ${(decodedToken.exp - decodedToken.iat) / 3600} hours`
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

    // Log token verification details for debugging
    const now = new Date();
    const tokenCreatedAt = new Date(decoded.iat * 1000);
    const tokenExpiresAt = new Date(decoded.exp * 1000);
    const timeUntilExpiry = decoded.exp * 1000 - now.getTime();
    const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);

    logger.info(`🔍 Token verification at: ${now.toISOString()}`);
    logger.info(`🔑 Token created at: ${tokenCreatedAt.toISOString()}`);
    logger.info(`⏰ Token expires at: ${tokenExpiresAt.toISOString()}`);
    logger.info(`⏱️ Time until expiry: ${hoursUntilExpiry.toFixed(2)} hours`);
    logger.info(
      `✅ Token is valid for user: ${decoded.email} (${decoded.role})`
    );

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
        expiresIn: "8h", // Access token expires in 8 hours (typical shift length)
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

// Debug endpoint to check token details
router.post("/debug-token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return sendError(res, "TOKEN_REQUIRED", "Token is required", 400);
    }

    // Decode token without verification (for debugging)
    const decoded = jwt.decode(token) as any;

    if (!decoded) {
      return sendError(res, "INVALID_TOKEN", "Could not decode token", 400);
    }

    const now = new Date();
    const tokenCreatedAt = new Date(decoded.iat * 1000);
    const tokenExpiresAt = new Date(decoded.exp * 1000);
    const timeUntilExpiry = decoded.exp * 1000 - now.getTime();
    const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);
    const isExpired = timeUntilExpiry < 0;

    const debugInfo = {
      tokenInfo: {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        tenantId: decoded.tenantId,
        type: decoded.type,
        iat: decoded.iat,
        exp: decoded.exp,
      },
      timing: {
        currentTime: now.toISOString(),
        tokenCreatedAt: tokenCreatedAt.toISOString(),
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        timeUntilExpiry: `${hoursUntilExpiry.toFixed(2)} hours`,
        isExpired: isExpired,
        serverTime: new Date().toISOString(),
      },
      analysis: {
        totalLifetime: `${((decoded.exp - decoded.iat) / 3600).toFixed(
          2
        )} hours`,
        remainingLifetime: `${Math.max(0, hoursUntilExpiry).toFixed(2)} hours`,
        percentageUsed: `${(
          ((now.getTime() - decoded.iat * 1000) /
            (decoded.exp * 1000 - decoded.iat * 1000)) *
          100
        ).toFixed(2)}%`,
      },
    };

    logger.info(`🔍 Token debug requested for user: ${decoded.email}`);
    logger.info(`📊 Debug info:`, debugInfo);

    sendSuccess(res, debugInfo, "Token debug information");
  } catch (error) {
    logger.error("Token debug error:", error);
    sendError(res, "DEBUG_ERROR", "Failed to debug token");
  }
});

export default router;
