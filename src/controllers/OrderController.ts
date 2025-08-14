import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { sendSuccess, sendError } from "../utils/response";
import { OrderService } from "../services/OrderService";
import { getTenantId } from "../middleware/tenant";

export class OrderController {
  /**
   * Create a new order
   */
  static async createOrder(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const orderData = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const order = await OrderService.createOrder({
        ...orderData,
        tenantId,
      });

      logger.info(`Order created via controller: ${order.id}`);
      return sendSuccess(res, { order }, "Order created successfully", 201);
    } catch (error) {
      logger.error("OrderController.createOrder error:", error);
      return sendError(res, "CREATE_ERROR", "Failed to create order");
    }
  }

  /**
   * Get order by ID
   */
  static async getOrder(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!orderId) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      const order = await OrderService.getOrderWithItems(orderId);

      // Verify order belongs to tenant
      if (order.tenantId !== tenantId) {
        return sendError(res, "ACCESS_DENIED", "Order not found", 404);
      }

      return sendSuccess(res, { order }, "Order retrieved successfully");
    } catch (error) {
      logger.error("OrderController.getOrder error:", error);
      return sendError(res, "NOT_FOUND", "Order not found", 404);
    }
  }

  /**
   * Update order
   */
  static async updateOrder(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;
      const updates = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!orderId) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      const updatedOrder = await OrderService.updateOrder(
        orderId,
        tenantId,
        updates
      );

      return sendSuccess(
        res,
        { order: updatedOrder },
        "Order updated successfully"
      );
    } catch (error) {
      logger.error("OrderController.updateOrder error:", error);
      return sendError(res, "UPDATE_ERROR", "Failed to update order");
    }
  }

  /**
   * Delete order
   */
  static async deleteOrder(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!orderId) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      const result = await OrderService.deleteOrder(orderId, tenantId);

      return sendSuccess(res, result, "Order deleted successfully");
    } catch (error) {
      logger.error("OrderController.deleteOrder error:", error);
      return sendError(res, "DELETE_ERROR", "Failed to delete order");
    }
  }

  /**
   * Get all orders with filters
   */
  static async getOrders(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const { status, tableNumber, limit, offset } = req.query;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      const filters: any = {};
      if (status) filters.status = status as string;
      if (tableNumber) filters.tableNumber = tableNumber as string;
      if (limit) filters.limit = parseInt(limit as string);
      if (offset) filters.offset = parseInt(offset as string);

      const orders = await OrderService.getOrders(tenantId, filters);

      return sendSuccess(res, { orders }, "Orders retrieved successfully");
    } catch (error) {
      logger.error("OrderController.getOrders error:", error);
      return sendError(res, "FETCH_ERROR", "Failed to fetch orders");
    }
  }

  /**
   * Mark order as paid
   */
  static async markOrderAsPaid(req: Request, res: Response) {
    try {
      const tenantId = getTenantId(req);
      const { orderId } = req.params;
      const { paymentMethod, paidByUserId } = req.body;

      if (!tenantId) {
        return sendError(res, "VALIDATION_ERROR", "Tenant ID is required", 400);
      }

      if (!paymentMethod) {
        return sendError(
          res,
          "VALIDATION_ERROR",
          "Payment method is required",
          400
        );
      }

      if (!orderId) {
        return sendError(res, "VALIDATION_ERROR", "Order ID is required", 400);
      }

      const updatedOrder = await OrderService.markOrderAsPaid(
        orderId,
        tenantId,
        paymentMethod,
        paidByUserId
      );

      return sendSuccess(
        res,
        { order: updatedOrder },
        "Order marked as paid successfully"
      );
    } catch (error) {
      logger.error("OrderController.markOrderAsPaid error:", error);
      return sendError(res, "PAYMENT_ERROR", "Failed to mark order as paid");
    }
  }
}
