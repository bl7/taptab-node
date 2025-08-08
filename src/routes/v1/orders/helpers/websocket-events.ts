// WebSocket event helper functions for order operations

import { socketManager } from "../../../../utils/socket";
import { logger } from "../../../../utils/logger";

export function emitNewOrderEvent(tenantId: string, formattedOrder: any): void {
  try {
    // Only emit for active orders
    if (formattedOrder.status === "active") {
      socketManager.emitNewOrder(tenantId, formattedOrder);
    } else {
      logger.info(
        `Skipping WebSocket notification for order ${formattedOrder.orderNumber} with status ${formattedOrder.status}`
      );
    }
  } catch (error) {
    logger.error("Failed to emit WebSocket event:", error);
    // Don't fail the order creation if WebSocket fails
  }
}

export function emitOrderModificationEvent(
  tenantId: string,
  updatedFormattedOrder: any,
  modificationData: {
    addedItems?: any[];
    removedItems?: any[];
    modifiedItems?: any[];
    modificationType: "add" | "remove" | "modify" | "mixed";
    modifiedBy: string;
    reason?: string;
  }
): void {
  try {
    logger.info("Attempting to emit order modification receipt...");
    socketManager.emitOrderModificationReceipt(
      tenantId,
      updatedFormattedOrder,
      modificationData
    );
    logger.info("Successfully emitted order modification receipt");
  } catch (error) {
    logger.error("Failed to emit WebSocket event:", error);
    // Don't fail the order modification if WebSocket fails
  }
}

export function getModifiedByUser(user: any): string {
  return user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.id || "Unknown";
}
