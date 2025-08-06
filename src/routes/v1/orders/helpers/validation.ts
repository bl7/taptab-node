// Validation helper functions for order operations

import { sendError } from "../../../../utils/response";
import { executeQuery } from "../../../../utils/database";
import { Response } from "express";

export async function validateTableExists(
  tableId: string,
  tenantId: string,
  res: Response
): Promise<boolean> {
  const tableResult = await executeQuery(
    'SELECT * FROM tables WHERE (number = $1 OR id = $1) AND "tenantId" = $2',
    [tableId, tenantId]
  );

  if (tableResult.rows.length === 0) {
    sendError(res, "TABLE_NOT_FOUND", `Table ${tableId} not found`, 400);
    return false;
  }
  return true;
}

export async function validateMenuItemExists(
  itemId: string,
  tenantId: string,
  res: Response
): Promise<any | null> {
  const menuItemResult = await executeQuery(
    'SELECT * FROM "menuItems" WHERE id = $1 AND "tenantId" = $2',
    [itemId, tenantId]
  );

  if (menuItemResult.rows.length === 0) {
    sendError(res, "MENU_ITEM_NOT_FOUND", "Menu item not found", 400);
    return null;
  }
  return menuItemResult.rows[0];
}

export async function validateOrderExists(
  orderId: string,
  tenantId: string,
  res: Response
): Promise<any | null> {
  const existingOrderResult = await executeQuery(
    'SELECT * FROM orders WHERE id = $1 AND "tenantId" = $2',
    [orderId, tenantId]
  );

  if (existingOrderResult.rows.length === 0) {
    sendError(res, "NOT_FOUND", "Order not found", 404);
    return null;
  }
  return existingOrderResult.rows[0];
}

export function validateOrderStatus(
  order: any,
  allowedStatuses: string[],
  res: Response
): boolean {
  if (!allowedStatuses.includes(order.status.toLowerCase())) {
    const statusList = allowedStatuses.join(", ");
    sendError(
      res,
      "INVALID_ORDER_STATUS",
      `Only ${statusList} orders can be processed`,
      400
    );
    return false;
  }
  return true;
}

export function mapOrderSource(orderSource: string): string {
  switch (orderSource.toUpperCase()) {
    case "QR":
      return "QR_ORDERING";
    case "WAITER":
      return "WAITER_ORDERING";
    case "CASHIER":
      return "CASHIER_ORDERING";
    case "MANAGER":
      return "MANAGER_ORDERING";
    default:
      return "WAITER_ORDERING";
  }
}

export function validateRequiredFields(
  fields: { [key: string]: any },
  res: Response
): boolean {
  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      sendError(res, "VALIDATION_ERROR", `${fieldName} is required`, 400);
      return false;
    }
  }
  return true;
}
