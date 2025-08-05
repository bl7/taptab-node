import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { createServer } from 'http';

import * as Sentry from '@sentry/node';
import prometheusMiddleware from 'express-prometheus-middleware';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { authenticateToken } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';

// Import routes
import authRoutes from './routes/v1/auth';
import menuRoutes from './routes/v1/menu';
import orderRoutes from './routes/v1/orders';
import tableRoutes from './routes/v1/tables';
import analyticsRoutes from './routes/v1/analytics';
import settingsRoutes from './routes/v1/settings';
import tenantRoutes from './routes/v1/tenants';
import uploadRoutes from './routes/v1/upload';

// Import public routes for QR ordering
import publicMenuRoutes from './routes/v1/public-menu';
import publicTableRoutes from './routes/v1/public-tables';
import publicOrderRoutes from './routes/v1/public-orders';

// Import services
import { logger } from './utils/logger';
import { socketManager } from './utils/socket';

// Debug: Check if env vars are loaded
console.log('DATABASE_URL exists:', !!process.env['DATABASE_URL']);
console.log('JWT_SECRET exists:', !!process.env['JWT_SECRET']);
console.log('PORT:', process.env['PORT'] || 5050);

// Import database utilities
import { executeQuery } from './utils/database';
import pool from './utils/api';

// Initialize Sentry
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] || 'development',
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: express() }),
    ],
    tracesSampleRate: 1.0,
  });
}

const app = express();

const PORT = process.env['PORT'] || 5050;



// Prometheus metrics
app.use(prometheusMiddleware({
  metricsPath: '/metrics',
  collectDefaultMetrics: true,
  requestDurationBuckets: [0.1, 0.5, 1, 2, 5],
  requestLengthBuckets: [512, 1024, 5120, 10240, 51200],
  responseLengthBuckets: [512, 1024, 5120, 10240, 51200],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '900000'), // 15 minutes
  max: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '100'),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(compression());
// Open CORS configuration - allows all origins
const corsOptions = {
  origin: true, // Allow all origins
  credentials: true, // Allow credentials
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'X-Tenant-ID'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting to all routes
app.use(limiter);
app.use(speedLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await executeQuery('SELECT 1');
    
    res.status(200).json({
      success: true,
      data: {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env['NODE_ENV'] || 'development',
        version: process.env['npm_package_version'] || '1.0.0',
      },
      message: 'Service is healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service is unhealthy',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes with versioning
const apiVersion = process.env['API_VERSION'] || 'v1';

// Debug endpoint to see connected WebSocket users
app.get('/api/debug/connected-users', (req, res) => {
  res.json({
    success: true,
    data: {
      connectedUsers: socketManager.getConnectedUsers()
    }
  });
});

// Debug endpoint to test WebSocket notifications
app.post('/api/debug/test-notification', (req, res) => {
  try {
    const { tenantId, message } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }

    const testData = {
      type: 'TEST_NOTIFICATION',
      message: message || 'Test notification from server',
      timestamp: new Date().toISOString()
    };

    // Emit to all users for testing
    socketManager.ioInstance?.emit('newOrder', testData);
    
    res.json({
      success: true,
      message: 'Test notification sent',
      data: testData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Public routes for QR ordering (no authentication required)
app.use(`/api/${apiVersion}/public/menu`, publicMenuRoutes);
app.use(`/api/${apiVersion}/public/tables`, publicTableRoutes);
app.use(`/api/${apiVersion}/public/orders`, publicOrderRoutes);

// Authenticated routes for admin/staff use (with authentication)
app.use(`/api/${apiVersion}/auth`, authRoutes);
app.use(`/api/${apiVersion}/menu`, authenticateToken, tenantMiddleware, menuRoutes);
app.use(`/api/${apiVersion}/orders`, authenticateToken, tenantMiddleware, orderRoutes);
app.use(`/api/${apiVersion}/tables`, authenticateToken, tenantMiddleware, tableRoutes);
app.use(`/api/${apiVersion}/analytics`, authenticateToken, tenantMiddleware, analyticsRoutes);
app.use(`/api/${apiVersion}/settings`, authenticateToken, tenantMiddleware, settingsRoutes);
app.use(`/api/${apiVersion}/tenants`, authenticateToken, tenantRoutes);
app.use(`/api/${apiVersion}/upload`, authenticateToken, tenantMiddleware, uploadRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Close database connection pool
    await pool.end();
    logger.info('Database connection pool closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    // Test database connection
    console.log('Testing database connection...');
    console.log('DATABASE_URL:', process.env['DATABASE_URL']?.substring(0, 20) + '...');
    
    await executeQuery('SELECT 1');
    logger.info('Database connected successfully');
    
    // Create HTTP server
    const server = createServer(app);
    
    // Initialize WebSocket support
    socketManager.initialize(server);
    
    server.listen(PORT, () => {
      logger.info(`🚀 TapTab Restaurant POS Backend running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env['NODE_ENV'] || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
      logger.info(`📈 Metrics: http://localhost:${PORT}/metrics`);
      logger.info(`🔌 WebSocket: ws://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    console.error('Full error:', error);
    process.exit(1);
  }
};

startServer();

export default app; 