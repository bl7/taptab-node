import { executeQuery } from "./database";
import { logger } from "./logger";

/**
 * Cleanup utility for abandoned pending orders
 */
export class CleanupService {
  /**
   * Clean up pending orders that are older than the specified time
   * @param maxAgeMinutes - Maximum age in minutes before cleanup (default: 30)
   */
  static async cleanupPendingOrders(maxAgeMinutes: number = 30) {
    try {
      const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
      const result = await executeQuery(
        `DELETE FROM orders 
         WHERE status = 'pending' 
           AND "createdAt" < $1`,
        [cutoffTime]
      );
      return result.rowCount;
    } catch (error) {
      logger.error("Error during pending orders cleanup:", error);
      throw error;
    }
  }

  /**
   * Get count of pending orders for monitoring
   */
  static async getPendingOrdersCount() {
    try {
      const result = await executeQuery(
        `SELECT COUNT(*) as count
         FROM orders 
         WHERE status = 'pending'`
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error("Error getting pending orders count:", error);
      throw error;
    }
  }

  /**
   * Get abandoned pending orders for manual review
   */
  static async getAbandonedPendingOrders(maxAgeMinutes: number = 30) {
    try {
      const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
      const result = await executeQuery(
        `SELECT id, "orderNumber", "tableNumber", "customerName", "createdAt", "finalAmount"
         FROM orders 
         WHERE status = 'pending'
           AND "createdAt" < $1
         ORDER BY "createdAt" ASC`,
        [cutoffTime]
      );
      return result.rows;
    } catch (error) {
      logger.error("Error getting abandoned pending orders:", error);
      throw error;
    }
  }
}
