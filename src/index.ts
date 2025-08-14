import dotenv from "dotenv";

// Load environment variables FIRST
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { createServer } from "http";

import * as Sentry from "@sentry/node";
import prometheusMiddleware from "express-prometheus-middleware";

// Import middleware
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { authenticateToken } from "./middleware/auth";
// import { tenantMiddleware } from "./middleware/tenant";

// Import routes
import authRoutes from "./routes/v1/auth";
import menuRoutes from "./routes/v1/menu";
import orderRoutes from "./routes/v1/orders";
import tableRoutes from "./routes/v1/tables";
import locationRoutes from "./routes/v1/locations";
import tableLayoutRoutes from "./routes/v1/table-layouts";
import analyticsRoutes from "./routes/v1/analytics";
import settingsRoutes from "./routes/v1/settings";
import tenantRoutes from "./routes/v1/tenants";
import uploadRoutes from "./routes/v1/upload";
import dashboardRoutes from "./routes/v1/dashboard";
import kitchenRoutes from "./routes/v1/kitchen";

// Import ingredient and allergen routes
import allergensRoutes from "./routes/v1/allergens";
import ingredientsRoutes from "./routes/v1/ingredients";
import ingredientAllergensRoutes from "./routes/v1/ingredient-allergens";
import menuItemIngredientsRoutes from "./routes/v1/menu-item-ingredients";
import menuTagsRoutes from "./routes/v1/menu-tags";
import menuItemTagsRoutes from "./routes/v1/menu-item-tags";
import simplePromotionsRoutes from "./routes/v1/simple-promotions";

// Import public routes for QR ordering
import publicMenuRoutes from "./routes/v1/public-menu";
import publicTableRoutes from "./routes/v1/public-tables";
import publicOrderRoutes from "./routes/v1/public-orders";
import publicTenantRoutes from "./routes/v1/public-tenant";

// Import Stripe payment routes
import stripePaymentRoutes from "./routes/v1/stripe-payments";

// Import admin cleanup routes
import adminCleanupRoutes from "./routes/v1/admin-cleanup";

// Import test routes
import testWebsocketRoutes from "./routes/v1/test-websocket";

// Import debug routes
import debugRoutes from "./routes/v1/debug-order";

// Import services
import { logger } from "./utils/logger";
import { socketManager } from "./utils/socket";
import { CleanupService } from "./utils/cleanup";

// Import database utilities
import { executeQuery } from "./utils/database";
import pool from "./utils/api";

// Initialize Sentry
if (process.env["SENTRY_DSN"]) {
  Sentry.init({
    dsn: process.env["SENTRY_DSN"],
    environment: process.env["NODE_ENV"] || "development",
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: express() }),
    ],
    tracesSampleRate: 1.0,
  });
}

const app = express();

const PORT = process.env["PORT"] || 5050;

// Prometheus metrics
app.use(
  prometheusMiddleware({
    metricsPath: "/metrics",
    collectDefaultMetrics: true,
    requestDurationBuckets: [0.1, 0.5, 1, 2, 5],
    requestLengthBuckets: [512, 1024, 5120, 10240, 51200],
    responseLengthBuckets: [512, 1024, 5120, 10240, 51200],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env["RATE_LIMIT_WINDOW_MS"] || "900000"), // 15 minutes
  max: parseInt(process.env["RATE_LIMIT_MAX_REQUESTS"] || "100"),
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests from this IP, please try again later.",
    },
    timestamp: new Date().toISOString(),
  },
});

// Speed limiting
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per 15 minutes, then...
  delayMs: () => 500, // begin adding 500ms of delay per request above 50
});

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);
app.use(compression());
// Open CORS configuration - allows all origins
const corsOptions = {
  origin: true, // Allow all origins
  credentials: true, // Allow credentials
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "X-API-Key",
    "X-Tenant-ID",
  ],
  exposedHeaders: ["X-Total-Count", "X-Page-Count"],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);
// Raw body middleware for Stripe webhooks (tenant-specific)
app.use(
  "/api/v1/webhooks/stripe/:tenantId",
  express.raw({ type: "application/json" })
);

// Regular JSON parsing for other routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply rate limiting to all routes
// Configure rate limiting for restaurant environments
// Allow higher limits for restaurant staff but still protect against abuse
app.use(limiter);

// Apply speed limiting to slow down excessive requests
app.use(speedLimiter);

// Health check endpoint
app.get("/health", async (_req, res) => {
  try {
    // Test database connection
    await executeQuery("SELECT 1");
    logger.info("Database connected successfully");

    res.status(200).json({
      success: true,
      data: {
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env["NODE_ENV"] || "development",
        version: process.env["npm_package_version"] || "1.0.0",
      },
      message: "Service is healthy",
    });
  } catch (error) {
    logger.error("Health check failed:", error);
    res.status(503).json({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service is unhealthy",
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes with versioning
const apiVersion = process.env["API_VERSION"] || "v1";

// Debug endpoint to see connected WebSocket users
app.get("/api/debug/connected-users", (_req, res) => {
  const connectedUsers = socketManager.getConnectedUsers();
  res.json({
    success: true,
    data: {
      connectedUsers,
      totalConnections: Object.keys(connectedUsers).length,
    },
  });
});

// Debug endpoint to test WebSocket notifications
app.post("/api/debug/test-notification", (_req, res) => {
  try {
    // Use the correct method from socketManager
    socketManager.ioInstance?.emit("test-notification", {
      message: "Test notification from debug endpoint",
      timestamp: new Date().toISOString(),
    });
    res.json({
      success: true,
      message: "Test notification sent",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATION_ERROR",
        message: "Failed to send test notification",
      },
    });
  }
});

// Public routes for QR ordering (no authentication required)
app.use(`/api/${apiVersion}/public/menu`, publicMenuRoutes);
app.use(`/api/${apiVersion}/public/tables`, publicTableRoutes);
app.use(`/api/${apiVersion}/public/orders`, publicOrderRoutes);
app.use(`/api/${apiVersion}/public`, publicTenantRoutes);

// Authenticated routes for admin/staff use (with authentication)
app.use(`/api/${apiVersion}/auth`, authRoutes);
app.use(`/api/${apiVersion}/menu`, authenticateToken, menuRoutes);
app.use(`/api/${apiVersion}/orders`, authenticateToken, orderRoutes);
app.use(`/api/${apiVersion}/tables`, authenticateToken, tableRoutes);
app.use(`/api/${apiVersion}/locations`, authenticateToken, locationRoutes);
app.use(
  `/api/${apiVersion}/table-layouts`,
  authenticateToken,
  tableLayoutRoutes
);
app.use(`/api/${apiVersion}/analytics`, authenticateToken, analyticsRoutes);
app.use(`/api/${apiVersion}/settings`, authenticateToken, settingsRoutes);
app.use(`/api/${apiVersion}/tenants`, authenticateToken, tenantRoutes);
app.use(`/api/${apiVersion}/upload`, authenticateToken, uploadRoutes);
app.use(`/api/${apiVersion}/dashboard`, authenticateToken, dashboardRoutes);

// Kitchen routes for order management
app.use(`/api/${apiVersion}/kitchen`, authenticateToken, kitchenRoutes);

// Ingredient and allergen routes
app.use(`/api/${apiVersion}/allergens`, authenticateToken, allergensRoutes);
app.use(`/api/${apiVersion}/ingredients`, authenticateToken, ingredientsRoutes);
app.use(
  `/api/${apiVersion}/ingredient-allergens`,
  authenticateToken,
  ingredientAllergensRoutes
);
app.use(
  `/api/${apiVersion}/menu-item-ingredients`,
  authenticateToken,
  menuItemIngredientsRoutes
);
app.use(`/api/${apiVersion}/menu-tags`, authenticateToken, menuTagsRoutes);
app.use(
  `/api/${apiVersion}/menu-item-tags`,
  authenticateToken,
  menuItemTagsRoutes
);
app.use(
  `/api/${apiVersion}/simple-promotions`,
  authenticateToken,
  simplePromotionsRoutes
);

// Stripe payment routes
app.use(`/api/${apiVersion}`, stripePaymentRoutes);

// Admin cleanup routes
app.use(`/api/${apiVersion}/admin/cleanup`, adminCleanupRoutes);

// Test routes
app.use(`/api/${apiVersion}/test`, testWebsocketRoutes);

// Debug routes
app.use(`/api/${apiVersion}/debug`, debugRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close database connection pool
    await pool.end();
    logger.info("Database connection pool closed");

    process.exit(0);
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await executeQuery("SELECT 1");
    logger.info("Database connected successfully");

    // Create HTTP server
    const server = createServer(app);

    // Initialize WebSocket support
    socketManager.initialize(server);

    server.listen(PORT, () => {
      logger.info(`🚀 TapTab Restaurant POS Backend running on port ${PORT}`);
      logger.info(
        `📊 Environment: ${process.env["NODE_ENV"] || "development"}`
      );
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
      logger.info(`📈 Metrics: http://localhost:${PORT}/metrics`);
      logger.info(`🔌 WebSocket: ws://localhost:${PORT}`);
    });

    // Set up cleanup cron job for abandoned pending orders
    const cron = require("node-cron");

    // Run cleanup every 15 minutes
    cron.schedule("*/15 * * * *", async () => {
      try {
        logger.info(
          "🕐 Running scheduled cleanup of abandoned pending orders..."
        );
        const cleanedCount = await CleanupService.cleanupPendingOrders(30); // 30 minutes
        logger.info(
          `✅ Cleanup completed. Cancelled ${cleanedCount} abandoned orders.`
        );
      } catch (error) {
        logger.error("❌ Error during scheduled cleanup:", error);
      }
    });

    logger.info("⏰ Scheduled cleanup job initialized (runs every 15 minutes)");
  } catch (error) {
    logger.error("Failed to start server:", error);
    console.error("Full error:", error);
    process.exit(1);
  }
};

startServer();

export default app;
