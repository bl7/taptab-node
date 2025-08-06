import { PoolClient } from "pg";
import { logger } from "./logger";
import pool from "./api";

export class DatabaseError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

// Get a client from the pool with retry logic
export const getClient = async (): Promise<PoolClient> => {
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      return client;
    } catch (error) {
      lastError = error;
      logger.error(`Database connection attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100)
        );
      }
    }
  }

  throw (
    lastError ||
    new DatabaseError(
      "Database connection failed after retries",
      "CONNECTION_ERROR"
    )
  );
};

// Generic find by ID with tenant check
export const findById = async (
  tableName: string,
  id: string,
  tenantId: string
) => {
  const client = await getClient();
  try {
    // Handle different tenant column names
    const tenantColumn = tableName === "menuItems" ? '"tenantId"' : "tenantid";
    const query = `SELECT * FROM "${tableName}" WHERE id = $1 AND ${tenantColumn} = $2`;
    const result = await client.query(query, [id, tenantId]);

    if (result.rows.length === 0) {
      throw new DatabaseError("Resource not found", "NOT_FOUND");
    }

    return result.rows[0];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error(`Database findById error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Generic create with duplicate check
export const createWithCheck = async (
  tableName: string,
  data: any,
  checkField: string,
  checkValue: string,
  tenantId: string
) => {
  const client = await getClient();
  try {
    // Check for duplicates - handle different tenant column names
    const tenantColumn = tableName === "menuItems" ? '"tenantId"' : "tenantid";
    const checkQuery = `SELECT id FROM "${tableName}" WHERE ${checkField} = $1 AND ${tenantColumn} = $2`;
    const checkResult = await client.query(checkQuery, [checkValue, tenantId]);

    if (checkResult.rows.length > 0) {
      throw new DatabaseError("Resource already exists", "DUPLICATE_ERROR");
    }

    // Build insert query
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const fieldNames = fields.map((field) => `"${field}"`).join(", ");

    const insertQuery = `INSERT INTO "${tableName}" (${fieldNames}) VALUES (${placeholders}) RETURNING *`;

    // DEBUG: Log the query being built
    console.log("=== DATABASE INSERT DEBUG ===");
    console.log("Table:", tableName);
    console.log("Fields:", fields);
    console.log("Field Names (quoted):", fieldNames);
    console.log("Insert Query:", insertQuery);
    console.log("Values:", values);
    console.log("=============================");

    const result = await client.query(insertQuery, values);

    return result.rows[0];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error(`Database createWithCheck error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Generic update with existence check
export const updateWithCheck = async (
  tableName: string,
  id: string,
  data: any,
  tenantId: string
) => {
  const client = await getClient();
  try {
    // Build update query
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields
      .map((field, index) => `"${field}" = $${index + 1}`)
      .join(", ");

    // Handle different tenant column names
    const tenantColumn = tableName === "menuItems" ? '"tenantId"' : "tenantid";
    const updateQuery = `UPDATE "${tableName}" SET ${setClause} WHERE id = $${
      values.length + 1
    } AND ${tenantColumn} = $${values.length + 2} RETURNING *`;
    const result = await client.query(updateQuery, [...values, id, tenantId]);

    if (result.rows.length === 0) {
      throw new DatabaseError("Resource not found", "NOT_FOUND");
    }

    return result.rows[0];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error(`Database updateWithCheck error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Generic delete with dependency check
export const deleteWithCheck = async (
  tableName: string,
  id: string,
  tenantId: string,
  dependencyCheck?: () => Promise<number>
) => {
  const client = await getClient();
  try {
    // Check dependencies if provided
    if (dependencyCheck) {
      const count = await dependencyCheck();
      if (count > 0) {
        throw new DatabaseError(
          "Cannot delete resource with dependencies",
          "DEPENDENCY_ERROR"
        );
      }
    }

    // Handle different tenant column names
    const tenantColumn = tableName === "menuItems" ? '"tenantId"' : "tenantid";
    const deleteQuery = `DELETE FROM "${tableName}" WHERE id = $1 AND ${tenantColumn} = $2`;
    const result = await client.query(deleteQuery, [id, tenantId]);

    if (result.rowCount === 0) {
      throw new DatabaseError("Resource not found", "NOT_FOUND");
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error(`Database deleteWithCheck error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Generic find many with conditions
export const findMany = async (
  tableName: string,
  conditions: any = {},
  orderBy?: string
) => {
  const client = await getClient();
  try {
    let query = `SELECT * FROM "${tableName}"`;
    const values: any[] = [];
    let whereClause = "";

    if (Object.keys(conditions).length > 0) {
      const conditionsArray = Object.entries(conditions).map(
        ([key, value], index) => {
          values.push(value);
          return `"${key}" = $${index + 1}`;
        }
      );
      whereClause = `WHERE ${conditionsArray.join(" AND ")}`;
    }

    if (orderBy) {
      query += ` ${whereClause} ORDER BY ${orderBy}`;
    } else {
      query += ` ${whereClause}`;
    }

    const result = await client.query(query, values);
    return result.rows;
  } catch (error) {
    logger.error(`Database findMany error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Execute raw query
export const executeQuery = async (query: string, values: any[] = []) => {
  const client = await getClient();
  try {
    const result = await client.query(query, values);
    return result;
  } catch (error) {
    logger.error(`Database executeQuery error: ${error}`);
    throw new DatabaseError("Database operation failed", "DATABASE_ERROR");
  } finally {
    client.release();
  }
};

// Get pool status for monitoring
export const getPoolStatus = () => {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
};

// Close the pool
export const closePool = async () => {
  await pool.end();
};
