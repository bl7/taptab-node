import { Pool } from "pg";
import { logger } from "./logger";

const pool = new Pool({
  host: process.env["DB_HOST"],
  port: parseInt(process.env["DB_PORT"] || "5432", 10),
  user: process.env["DB_USER"],
  password: process.env["DB_PASSWORD"],
  database: process.env["DB_NAME"],
  ssl: {
    rejectUnauthorized: false, // required for Aiven
  },
  // Optimized connection pool settings
  max: 10, // Reduced from 20 to avoid hitting DB limits
  min: 2, // Keep at least 2 connections ready
  idleTimeoutMillis: 10000, // Close idle clients after 10 seconds (reduced from 30)
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds (reduced from 10)
  maxUses: 1000, // Close connections after 1000 uses (reduced from 7500)
  // Add connection retry logic
  // acquireTimeoutMillis: 3000, // Timeout for acquiring connection (not valid in pg pool config)
});

// Test database connection
pool.query("SELECT current_database()", (err, res) => {
  if (err) {
    logger.error("Database connection failed:", err);
  } else {
    logger.info(`Connected to database: ${res.rows[0].current_database}`);
  }
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

// Monitor pool status
setInterval(() => {
  console.log(
    `📊 Pool Status - Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`
  );
}, 30000); // Log every 30 seconds

export default pool;
