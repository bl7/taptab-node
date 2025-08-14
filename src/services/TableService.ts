import { executeQuery } from "../utils/database";
import { logger } from "../utils/logger";

export interface CreateTableData {
  number: string;
  capacity: number;
  tenantId: string;
  isActive?: boolean;
  location?: string;
  tableType?: string;
  qrCode?: string;
}

export interface UpdateTableData {
  number?: string;
  capacity?: number;
  isActive?: boolean;
  location?: string;
  tableType?: string;
  qrCode?: string;
  currentOrderId?: string;
  status?: string;
}

export interface TableFilters {
  isActive?: boolean;
  status?: string;
  location?: string;
  tableType?: string;
  hasActiveOrder?: boolean;
}

export class TableService {
  /**
   * Create a new table
   */
  static async createTable(tableData: CreateTableData) {
    const {
      number,
      capacity,
      tenantId,
      isActive = true,
      location = "",
      tableType = "standard",
      qrCode = "",
    } = tableData;

    // Validate required fields
    if (!number || !capacity || !tenantId) {
      throw new Error("Table number, capacity, and tenant ID are required");
    }

    // Check if table number already exists for this tenant
    const existingTable = await executeQuery(
      'SELECT id FROM tables WHERE number = $1 AND "tenantId" = $2',
      [number, tenantId]
    );

    if (existingTable.rows.length > 0) {
      throw new Error("Table number already exists for this restaurant");
    }

    // Generate table ID
    const tableId = `table_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 5)}`;

    // Create table
    const query = `
      INSERT INTO tables (
        id, number, capacity, "tenantId", "isActive", location, "tableType", 
        "qrCode", status, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const now = new Date();
    const result = await executeQuery(query, [
      tableId,
      number,
      capacity,
      tenantId,
      isActive,
      location,
      tableType,
      qrCode,
      "available",
      now,
      now,
    ]);

    const table = result.rows[0];
    logger.info(`Table created: ${tableId} - ${number} (${capacity} seats)`);
    return table;
  }

  /**
   * Get table by ID
   */
  static async getTable(tableId: string, tenantId: string) {
    const result = await executeQuery(
      'SELECT * FROM tables WHERE id = $1 AND "tenantId" = $2',
      [tableId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Table not found");
    }

    return result.rows[0];
  }

  /**
   * Get table by number
   */
  static async getTableByNumber(tableNumber: string, tenantId: string) {
    const result = await executeQuery(
      'SELECT * FROM tables WHERE number = $1 AND "tenantId" = $2',
      [tableNumber, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Table not found");
    }

    return result.rows[0];
  }

  /**
   * Update table
   */
  static async updateTable(
    tableId: string,
    tenantId: string,
    updates: UpdateTableData
  ) {
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query
    if (updates.number !== undefined) {
      updateFields.push(`number = $${paramIndex++}`);
      values.push(updates.number);
    }

    if (updates.capacity !== undefined) {
      updateFields.push(`capacity = $${paramIndex++}`);
      values.push(updates.capacity);
    }

    if (updates.isActive !== undefined) {
      updateFields.push(`"isActive" = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    if (updates.location !== undefined) {
      updateFields.push(`location = $${paramIndex++}`);
      values.push(updates.location);
    }

    if (updates.tableType !== undefined) {
      updateFields.push(`"tableType" = $${paramIndex++}`);
      values.push(updates.tableType);
    }

    if (updates.qrCode !== undefined) {
      updateFields.push(`"qrCode" = $${paramIndex++}`);
      values.push(updates.qrCode);
    }

    if (updates.currentOrderId !== undefined) {
      updateFields.push(`"currentOrderId" = $${paramIndex++}`);
      values.push(updates.currentOrderId);
    }

    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    updateFields.push(`"updatedAt" = $${paramIndex++}`);
    values.push(new Date());

    // Add WHERE clause parameters
    values.push(tableId);
    values.push(tenantId);

    const updateQuery = `
      UPDATE tables 
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex++} AND "tenantId" = $${paramIndex++}
      RETURNING *
    `;

    const result = await executeQuery(updateQuery, values);

    if (result.rows.length === 0) {
      throw new Error("Table not found or access denied");
    }

    logger.info(`Table updated: ${tableId}`);
    return result.rows[0];
  }

  /**
   * Delete table
   */
  static async deleteTable(tableId: string, tenantId: string) {
    // Check if table has active orders
    const activeOrdersCheck = await executeQuery(
      'SELECT COUNT(*) as count FROM orders WHERE "tableNumber" = $1 AND status IN ($2, $3)',
      [tableId, "pending", "active"]
    );

    if (parseInt(activeOrdersCheck.rows[0].count) > 0) {
      throw new Error("Cannot delete table with active orders");
    }

    const result = await executeQuery(
      'DELETE FROM tables WHERE id = $1 AND "tenantId" = $2 RETURNING id',
      [tableId, tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error("Table not found or access denied");
    }

    logger.info(`Table deleted: ${tableId}`);
    return { success: true, tableId };
  }

  /**
   * Get all tables for a tenant with filters
   */
  static async getTables(tenantId: string, filters: TableFilters = {}) {
    let query = `
      SELECT t.*, 
             COUNT(o.id) as active_order_count,
             o.id as current_order_id,
             o.status as current_order_status
      FROM tables t
      LEFT JOIN orders o ON t.id = o."tableNumber" AND o.status IN ('pending', 'active')
      WHERE t."tenantId" = $1
    `;

    const values = [tenantId];
    let paramIndex = 2;

    if (filters.isActive !== undefined) {
      query += ` AND t."isActive" = $${paramIndex++}`;
      values.push(filters.isActive ? "true" : "false");
    }

    if (filters.status) {
      query += ` AND t.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.location) {
      query += ` AND t.location = $${paramIndex++}`;
      values.push(filters.location);
    }

    if (filters.tableType) {
      query += ` AND t."tableType" = $${paramIndex++}`;
      values.push(filters.tableType);
    }

    query += ` GROUP BY t.id, o.id, o.status ORDER BY t.number`;

    const result = await executeQuery(query, values);
    return result.rows;
  }

  /**
   * Get table layout for a tenant
   */
  static async getTableLayout(tenantId: string) {
    const query = `
      SELECT t.*, 
             o.id as current_order_id,
             o.status as current_order_status,
             o."customerName" as current_customer_name,
             o."totalAmount" as current_order_total
      FROM tables t
      LEFT JOIN orders o ON t.id = o."tableNumber" AND o.status IN ('pending', 'active')
      WHERE t."tenantId" = $1
      ORDER BY t.location, t.number
    `;

    const result = await executeQuery(query, [tenantId]);
    return result.rows;
  }

  /**
   * Update table status
   */
  static async updateTableStatus(
    tableId: string,
    tenantId: string,
    status: string
  ) {
    return this.updateTable(tableId, tenantId, { status });
  }

  /**
   * Assign order to table
   */
  static async assignOrderToTable(
    tableId: string,
    tenantId: string,
    orderId: string
  ) {
    return this.updateTable(tableId, tenantId, {
      currentOrderId: orderId,
      status: "occupied",
    });
  }

  /**
   * Clear table (remove order assignment)
   */
  static async clearTable(tableId: string, tenantId: string) {
    const updates: any = { status: "available" };
    return this.updateTable(tableId, tenantId, updates);
  }

  /**
   * Get available tables for a tenant
   */
  static async getAvailableTables(tenantId: string, capacity?: number) {
    let query = `
      SELECT t.*
      FROM tables t
      WHERE t."tenantId" = $1 
        AND t."isActive" = true 
        AND t.status = 'available'
    `;

    const values = [tenantId];

    if (capacity) {
      query += ` AND t.capacity >= $2`;
      values.push(capacity.toString());
    }

    query += ` ORDER BY t.capacity, t.number`;

    const result = await executeQuery(query, values);
    return result.rows;
  }
}
