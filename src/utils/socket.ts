import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from './logger';

interface AuthenticatedSocket {
  userId: string;
  userRole: string;
  tenantId: string;
}

class SocketManager {
  private io: SocketIOServer | null = null;
  private authenticatedSockets: Map<string, AuthenticatedSocket> = new Map();

  // Getter for io to allow external access for debugging
  get ioInstance() {
    return this.io;
  }

  initialize(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: true, // Allow all origins
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Handle authentication
      socket.on('authenticate', (data: { token: string }) => {
        try {
          // Verify JWT token and extract user info
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(data.token, process.env['JWT_SECRET']);
          
          const userInfo: AuthenticatedSocket = {
            userId: decoded.id,
            userRole: decoded.role,
            tenantId: decoded.tenantId
          };

          this.authenticatedSockets.set(socket.id, userInfo);
          
          // Join tenant-specific room
          socket.join(`tenant_${userInfo.tenantId}`);
          
          // Join role-specific room for printing
          if (userInfo.userRole === 'TENANT_ADMIN' || userInfo.userRole === 'KITCHEN') {
            socket.join(`print_${userInfo.tenantId}`);
            logger.info(`User ${userInfo.userId} (${userInfo.userRole}) joined print room for tenant ${userInfo.tenantId}`);
          }

          socket.emit('authenticated', { success: true });
          logger.info(`Socket ${socket.id} authenticated as ${userInfo.userRole}`);
        } catch (error) {
          logger.error('Socket authentication failed:', error);
          socket.emit('authentication_error', { message: 'Invalid token' });
        }
      });

      socket.on('disconnect', () => {
        this.authenticatedSockets.delete(socket.id);
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });

    logger.info('Socket.IO server initialized');
  }

  // Emit new order to admin and kitchen staff only
  emitNewOrder(tenantId: string, orderData: any) {
    if (!this.io) {
      logger.error('Socket.IO not initialized');
      return;
    }

    const notificationId = `new_order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const notificationData = {
      type: 'PRINT_RECEIPT',
      order: orderData,
      notificationId,
      timestamp: new Date().toISOString()
    };

    // Emit to all users (same as test notification)
    this.io.emit('newOrder', notificationData);

    logger.info(`=== NEW ORDER NOTIFICATION TRIGGERED ===`);
    logger.info(`Event: newOrder`);
    logger.info(`Type: PRINT_RECEIPT`);
    logger.info(`Notification ID: ${notificationId}`);
    logger.info(`Tenant ID: ${tenantId}`);
    logger.info(`Order ID: ${orderData.id}`);
    logger.info(`Notification data:`, notificationData);
    
    // Log connected users for debugging
    const connectedUsers = this.getConnectedUsers();
    logger.info(`Connected users:`, connectedUsers);
  }

  // Emit order modification with complete order and changes for receipt
  emitOrderModificationReceipt(tenantId: string, orderData: any, changes: {
    addedItems?: Array<{name: string, quantity: number, price: number, notes?: string}>,
    removedItems?: Array<{name: string, quantity: number, price: number, reason?: string}>,
    modifiedItems?: Array<{name: string, oldQuantity: number, newQuantity: number, price: number, notes?: string}>,
    modificationType: 'add' | 'remove' | 'modify' | 'mixed',
    modifiedBy: string,
    reason?: string
  }) {
    logger.info('emitOrderModificationReceipt called');
    
    if (!this.io) {
      logger.error('Socket.IO not initialized');
      return;
    }

    const notificationId = `modified_order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const notificationData = {
      type: 'PRINT_MODIFIED_RECEIPT',
      order: orderData,
      changes,
      notificationId,
      timestamp: new Date().toISOString()
    };

    logger.info('About to emit orderModified event');
    // Emit to all users
    this.io.emit('orderModified', notificationData);
    logger.info('orderModified event emitted');

    logger.info(`=== ORDER MODIFICATION NOTIFICATION TRIGGERED ===`);
    logger.info(`Event: orderModified`);
    logger.info(`Type: PRINT_MODIFIED_RECEIPT`);
    logger.info(`Notification ID: ${notificationId}`);
    logger.info(`Tenant ID: ${tenantId}`);
    logger.info(`Order ID: ${orderData.id}`);
    logger.info(`Modification type: ${changes.modificationType}`);
    logger.info(`Modified by: ${changes.modifiedBy}`);
    logger.info(`Notification data:`, notificationData);
  }

  // Get connected users for debugging
  getConnectedUsers() {
    const users: any[] = [];
    this.authenticatedSockets.forEach((userInfo, socketId) => {
      users.push({
        socketId,
        ...userInfo
      });
    });
    return users;
  }
}

export const socketManager = new SocketManager(); 