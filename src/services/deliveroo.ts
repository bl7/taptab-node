import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { executeQuery } from '../utils/database';
import { socketManager } from '../utils/socket';

// Deliveroo API Types - These should be updated based on actual API documentation
interface DeliverooOrder {
  id: string;
  reference: string;
  status: string;
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  items: DeliverooOrderItem[];
  total: {
    amount: number;
    currency: string;
  };
  created_at: string;
  updated_at: string;
  estimated_delivery_time?: string;
  special_instructions?: string;
  fulfillment_type: string;
}

interface DeliverooOrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string;
  modifiers?: string[];
}

interface DeliverooMenuCategory {
  id: string;
  name: string;
  description?: string;
  sort_order: number;
}

interface DeliverooMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category_id: string;
  image_url?: string;
  allergens?: string[];
  available: boolean;
  pos_id?: string;
}

interface DeliverooSite {
  id: string;
  name: string;
  status: 'open' | 'closed' | 'busy';
  opening_hours: DeliverooOpeningHours[];
  workload_mode?: string;
}

interface DeliverooOpeningHours {
  day: number; // 0-6 (Sunday-Saturday)
  open_time: string; // HH:MM
  close_time: string; // HH:MM
  closed: boolean;
}

interface DeliverooWebhookPayload {
  event: string;
  order_id: string;
  order: DeliverooOrder;
  timestamp: string;
}

// Restaurant-specific Deliveroo configuration
interface DeliverooConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  authHost: string;
  webhookSecret?: string;
}

class DeliverooService {
  private api: AxiosInstance;
  private tenantId: string;
  private config: DeliverooConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    
    // Initialize API with default config
    this.api = axios.create({
      baseURL: 'https://api-sandbox.developers.deliveroo.com',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor for Basic Authentication
    this.api.interceptors.request.use(async (config) => {
      await this.ensureValidCredentials();
      if (this.config) {
        const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
        config.headers.Authorization = `Basic ${credentials}`;
      }
      return config;
    });
  }

  private async initializeConfig(): Promise<void> {
    if (!this.config) {
      this.config = await this.getRestaurantConfig(this.tenantId);
      this.api.defaults.baseURL = this.config.apiUrl;
    }
  }

  // Get restaurant-specific Deliveroo configuration
  private async getRestaurantConfig(tenantId: string): Promise<DeliverooConfig> {
    try {
      const result = await executeQuery(
        'SELECT "clientId", "clientSecret" FROM "deliverooConfigs" WHERE "tenantId" = $1 AND "isActive" = true',
        [tenantId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('No active Deliveroo configuration found for this tenant');
      }
      
      const config = result.rows[0];
      return {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        apiUrl: 'https://api.developers.deliveroo.com',
        authHost: 'https://auth.developers.deliveroo.com',
        webhookSecret: undefined // Not provided by Deliveroo
      };
    } catch (error) {
      logger.error('Error getting Deliveroo config:', error);
      throw new Error('Failed to get Deliveroo configuration');
    }
  }

  // Basic Authentication - No need for OAuth tokens
  private async ensureValidCredentials(): Promise<void> {
    await this.initializeConfig();
    
    if (!this.config) {
      throw new Error('No Deliveroo configuration available');
    }
  }

  // ==================== ORDER API ====================
  // Update these endpoints based on actual Deliveroo API documentation

  async getOrders(status?: string, limit: number = 50): Promise<DeliverooOrder[]> {
    try {
      await this.ensureValidCredentials();
      
      const params: any = { limit };
      if (status) params.status = status;

      // Use Basic Authentication for API calls
      const response = await this.api.get('/orders', { params });
      return response.data.orders || [];
    } catch (error) {
      logger.error('Error fetching Deliveroo orders:', error);
      throw new Error('Failed to fetch Deliveroo orders');
    }
  }

  async getOrder(orderId: string): Promise<DeliverooOrder> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.get(`/orders/${orderId}`);
      return response.data;
    } catch (error) {
      logger.error('Error fetching Deliveroo order:', error);
      throw new Error('Failed to fetch Deliveroo order');
    }
  }

  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.put(`/orders/${orderId}/status`, { status });
      logger.info(`Updated Deliveroo order ${orderId} status to ${status}`);
    } catch (error) {
      logger.error('Error updating Deliveroo order status:', error);
      throw new Error('Failed to update Deliveroo order status');
    }
  }

  // ==================== MENU API ====================
  // Update these endpoints based on actual Deliveroo API documentation

  async getMenuCategories(): Promise<DeliverooMenuCategory[]> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.get('/menu/categories');
      return response.data.categories || [];
    } catch (error) {
      logger.error('Error fetching Deliveroo menu categories:', error);
      throw new Error('Failed to fetch Deliveroo menu categories');
    }
  }

  async createMenuCategory(category: Omit<DeliverooMenuCategory, 'id'>): Promise<DeliverooMenuCategory> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.post('/menu/categories', category);
      return response.data;
    } catch (error) {
      logger.error('Error creating Deliveroo menu category:', error);
      throw new Error('Failed to create Deliveroo menu category');
    }
  }

  async updateMenuCategory(categoryId: string, category: Partial<DeliverooMenuCategory>): Promise<DeliverooMenuCategory> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.put(`/menu/categories/${categoryId}`, category);
      return response.data;
    } catch (error) {
      logger.error('Error updating Deliveroo menu category:', error);
      throw new Error('Failed to update Deliveroo menu category');
    }
  }

  async deleteMenuCategory(categoryId: string): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.delete(`/menu/categories/${categoryId}`);
      logger.info(`Deleted Deliveroo menu category ${categoryId}`);
    } catch (error) {
      logger.error('Error deleting Deliveroo menu category:', error);
      throw new Error('Failed to delete Deliveroo menu category');
    }
  }

  async getMenuItems(categoryId?: string): Promise<DeliverooMenuItem[]> {
    try {
      const params: any = {};
      if (categoryId) params.category_id = categoryId;

      // Update endpoint based on actual Deliveroo API
      const response = await this.api.get('/menu/items', { params });
      return response.data.items || [];
    } catch (error) {
      logger.error('Error fetching Deliveroo menu items:', error);
      throw new Error('Failed to fetch Deliveroo menu items');
    }
  }

  async createMenuItem(item: Omit<DeliverooMenuItem, 'id'>): Promise<DeliverooMenuItem> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.post('/menu/items', item);
      return response.data;
    } catch (error) {
      logger.error('Error creating Deliveroo menu item:', error);
      throw new Error('Failed to create Deliveroo menu item');
    }
  }

  async updateMenuItem(itemId: string, item: Partial<DeliverooMenuItem>): Promise<DeliverooMenuItem> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.put(`/menu/items/${itemId}`, item);
      return response.data;
    } catch (error) {
      logger.error('Error updating Deliveroo menu item:', error);
      throw new Error('Failed to update Deliveroo menu item');
    }
  }

  async deleteMenuItem(itemId: string): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.delete(`/menu/items/${itemId}`);
      logger.info(`Deleted Deliveroo menu item ${itemId}`);
    } catch (error) {
      logger.error('Error deleting Deliveroo menu item:', error);
      throw new Error('Failed to delete Deliveroo menu item');
    }
  }

  // ==================== SITE API ====================
  // Update these endpoints based on actual Deliveroo API documentation

  async getSite(): Promise<DeliverooSite> {
    try {
      // Update endpoint based on actual Deliveroo API
      const response = await this.api.get('/site');
      return response.data;
    } catch (error) {
      logger.error('Error fetching Deliveroo site:', error);
      throw new Error('Failed to fetch Deliveroo site');
    }
  }

  async updateSiteStatus(status: 'open' | 'closed' | 'busy'): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.put('/site/status', { status });
      logger.info(`Updated Deliveroo site status to ${status}`);
    } catch (error) {
      logger.error('Error updating Deliveroo site status:', error);
      throw new Error('Failed to update Deliveroo site status');
    }
  }

  async updateOpeningHours(openingHours: DeliverooOpeningHours[]): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.put('/site/opening-hours', { opening_hours: openingHours });
      logger.info('Updated Deliveroo opening hours');
    } catch (error) {
      logger.error('Error updating Deliveroo opening hours:', error);
      throw new Error('Failed to update Deliveroo opening hours');
    }
  }

  async updateWorkloadMode(mode: string): Promise<void> {
    try {
      // Update endpoint based on actual Deliveroo API
      await this.api.put('/site/workload-mode', { mode });
      logger.info(`Updated Deliveroo workload mode to ${mode}`);
    } catch (error) {
      logger.error('Error updating Deliveroo workload mode:', error);
      throw new Error('Failed to update Deliveroo workload mode');
    }
  }

  // ==================== WEBHOOK HANDLING ====================

  async processWebhook(payload: DeliverooWebhookPayload): Promise<void> {
    try {
      const order = this.mapDeliverooOrder(payload.order);
      
      // Check if order already exists
      const existingOrder = await executeQuery(
        'SELECT * FROM orders WHERE "deliverooOrderId" = $1 AND "tenantId" = $2',
        [payload.order_id, this.tenantId]
      );

      if (existingOrder.rows.length > 0) {
        // Update existing order
        await this.updateOrder(existingOrder.rows[0].id, order);
      } else {
        // Create new order
        await this.createOrder(order);
      }

      logger.info(`Processed Deliveroo webhook for order ${payload.order_id}`);
    } catch (error) {
      logger.error('Error processing Deliveroo webhook:', error);
      throw error;
    }
  }

  // Map Deliveroo order to our internal format
  private mapDeliverooOrder(deliverooOrder: DeliverooOrder): any {
    const orderItems = deliverooOrder.items.map(item => ({
      id: `deliveroo_item_${item.id}`,
      menuItemId: `deliveroo_${item.id}`,
      menuItemName: item.name,
      quantity: item.quantity,
      price: item.price,
      notes: item.notes || null,
      status: 'pending'
    }));

    return {
      id: `deliveroo_order_${deliverooOrder.id}`,
      orderNumber: `DEL-${deliverooOrder.reference}`,
      tableNumber: 'DELIVEROO',
      totalAmount: deliverooOrder.total.amount,
      finalAmount: deliverooOrder.total.amount,
      status: this.mapDeliverooStatus(deliverooOrder.status),
      customerName: deliverooOrder.customer.name,
      customerPhone: deliverooOrder.customer.phone,
      customerAddress: deliverooOrder.customer.address,
      items: orderItems,
      orderSource: 'DELIVEROO',
      deliverooOrderId: deliverooOrder.id,
      deliverooReference: deliverooOrder.reference,
      estimatedDeliveryTime: deliverooOrder.estimated_delivery_time,
      specialInstructions: deliverooOrder.special_instructions,
      fulfillmentType: deliverooOrder.fulfillment_type,
      createdAt: deliverooOrder.created_at,
      updatedAt: deliverooOrder.updated_at
    };
  }

  // Map Deliveroo status to our internal status
  private mapDeliverooStatus(deliverooStatus: string): string {
    const statusMap: { [key: string]: string } = {
      'accepted': 'PENDING',
      'confirmed': 'PREPARING',
      'ready_for_pickup': 'READY',
      'picked_up': 'DELIVERED',
      'cancelled': 'CANCELLED'
    };
    return statusMap[deliverooStatus] || 'PENDING';
  }

  // Create order in our database
  private async createOrder(orderData: any): Promise<void> {
    const orderId = orderData.id;
    
    // Insert order using existing delivery fields
    await executeQuery(
      `INSERT INTO orders (
        id, "orderNumber", "tableNumber", "totalAmount", "finalAmount", 
        "tenantId", status, "customerName", "customerPhone", "orderSource",
        "isDelivery", "deliveryAddress", "deliveryPlatform", "deliveryOrderId",
        "deliverooOrderId", "deliverooReference", "estimatedDeliveryTime", 
        "specialInstructions", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        orderId,
        orderData.orderNumber,
        orderData.tableNumber,
        orderData.totalAmount,
        orderData.finalAmount,
        this.tenantId,
        orderData.status,
        orderData.customerName,
        orderData.customerPhone,
        orderData.orderSource,
        true, // isDelivery
        orderData.customerAddress, // deliveryAddress
        'DELIVEROO', // deliveryPlatform
        orderData.deliverooOrderId, // deliveryOrderId
        orderData.deliverooOrderId,
        orderData.deliverooReference,
        orderData.estimatedDeliveryTime,
        orderData.specialInstructions,
        orderData.createdAt,
        orderData.updatedAt
      ]
    );

    // Insert order items
    for (const item of orderData.items) {
      await executeQuery(
        `INSERT INTO "orderItems" (
          id, "orderId", "menuItemId", quantity, "unitPrice", "totalPrice", 
          notes, "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          item.id,
          orderId,
          item.menuItemId,
          item.quantity,
          item.price,
          item.price * item.quantity,
          item.notes,
          new Date(),
          new Date()
        ]
      );
    }

    // Emit WebSocket notification
    socketManager.emitNewOrder(this.tenantId, {
      ...orderData,
      source: 'DELIVEROO',
      isDeliverooOrder: true
    });

    logger.info(`Created Deliveroo order: ${orderData.orderNumber}`);
  }

  // Update existing order
  private async updateOrder(orderId: string, orderData: any): Promise<void> {
    // Update order
    await executeQuery(
      `UPDATE orders SET 
        status = $1, "customerName" = $2, "customerPhone" = $3,
        "estimatedDeliveryTime" = $4, "specialInstructions" = $5, "updatedAt" = $6
       WHERE id = $7`,
      [
        orderData.status,
        orderData.customerName,
        orderData.customerPhone,
        orderData.estimatedDeliveryTime,
        orderData.specialInstructions,
        new Date(),
        orderId
      ]
    );

    // Emit WebSocket notification for status update
    socketManager.emitNewOrder(this.tenantId, {
      ...orderData,
      id: orderId,
      source: 'DELIVEROO',
      isDeliverooOrder: true,
      isUpdate: true
    });

    logger.info(`Updated Deliveroo order: ${orderData.orderNumber}`);
  }
}

export { DeliverooService, DeliverooWebhookPayload, DeliverooOrder, DeliverooMenuItem, DeliverooSite, DeliverooOpeningHours }; 