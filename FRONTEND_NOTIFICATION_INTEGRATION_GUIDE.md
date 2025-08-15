# Frontend Notification Integration Guide

## Overview

This guide shows how to integrate and use the real-time menu item availability notifications in your frontend application.

## 1. WebSocket Connection Setup

### Basic WebSocket Service

```tsx
// services/availabilityWebSocket.ts
import { io, Socket } from "socket.io-client";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

export class AvailabilityWebSocketService {
  private socket: Socket | null = null;
  private token: string;
  private onNotification?: (data: any) => void;

  constructor(token: string, onNotification?: (data: any) => void) {
    this.token = token;
    this.onNotification = onNotification;
  }

  connect() {
    // Replace with your actual WebSocket server URL
    this.socket = io("ws://localhost:3000", {
      auth: {
        token: this.token,
      },
    });

    this.socket.on("connect", () => {
      console.log("✅ Connected to WebSocket server");

      // Authenticate the socket
      this.socket?.emit("authenticate", { token: this.token });
    });

    this.socket.on("authenticated", () => {
      console.log("🔐 WebSocket authenticated successfully");
    });

    this.socket.on("menuItemAvailabilityUpdate", (data) => {
      if (data.type === "MENU_ITEM_AVAILABILITY_UPDATE") {
        const { itemId, available, itemName } = data.payload;
        const title =
          data.title || `Menu Item ${available ? "Available" : "Out of Stock"}`;

        // Update the availability store
        useMenuAvailabilityStore
          .getState()
          .setItemAvailability(itemId, available);

        // Trigger custom notification handler
        if (this.onNotification) {
          this.onNotification({
            title,
            itemName,
            available,
            itemId,
            timestamp: data.timestamp,
          });
        }

        // Log for debugging
        console.log(
          `📢 ${title}: ${itemName} is now ${
            available ? "available" : "out of stock"
          }`
        );
      }
    });

    this.socket.on("disconnect", () => {
      console.log("❌ Disconnected from WebSocket server");
    });

    this.socket.on("connect_error", (error) => {
      console.error("🔌 WebSocket connection error:", error);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Method to manually check connection status
  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}
```

## 2. Notification Components

### Toast Notification Component

```tsx
// components/NotificationToast.tsx
import React, { useEffect, useState } from "react";

interface NotificationToastProps {
  message: string;
  title: string;
  type: "success" | "warning" | "error" | "info";
  duration?: number;
  onClose: () => void;
}

const NotificationToast: React.FC<NotificationToastProps> = ({
  message,
  title,
  type,
  duration = 5000,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for fade out animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return "✅";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      case "info":
        return "ℹ️";
      default:
        return "📢";
    }
  };

  const getBgColor = () => {
    switch (type) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      case "info":
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm w-full ${getBgColor()} text-white rounded-lg shadow-lg transition-all duration-300 ${
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <span className="text-xl">{getIcon()}</span>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="mt-1 text-sm opacity-90">{message}</p>
          </div>
          <div className="ml-4 flex-shrink-0">
            <button
              onClick={() => {
                setIsVisible(false);
                setTimeout(onClose, 300);
              }}
              className="text-white hover:text-gray-200 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationToast;
```

### Notification Manager

```tsx
// components/NotificationManager.tsx
import React, { useState, useCallback } from "react";
import NotificationToast from "./NotificationToast";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "success" | "warning" | "error" | "info";
  timestamp: Date;
}

interface NotificationManagerProps {
  children: React.ReactNode;
}

const NotificationManager: React.FC<NotificationManagerProps> = ({
  children,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "timestamp">) => {
      const newNotification: Notification = {
        ...notification,
        id: `notification_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        timestamp: new Date(),
      };

      setNotifications((prev) => [...prev, newNotification]);
    },
    []
  );

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Expose addNotification method globally
  React.useEffect(() => {
    (window as any).addNotification = addNotification;
    return () => {
      delete (window as any).addNotification;
    };
  }, [addNotification]);

  return (
    <>
      {children}

      {/* Render all active notifications */}
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          title={notification.title}
          message={notification.message}
          type={notification.type}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </>
  );
};

export default NotificationManager;
```

## 3. Integration in Main App

### App Component with Notifications

```tsx
// App.tsx
import React, { useEffect, useState } from "react";
import { AvailabilityWebSocketService } from "./services/availabilityWebSocket";
import { NotificationManager } from "./components/NotificationManager";
import { useMenuAvailabilityStore } from "./stores/menuAvailabilityStore";

function App() {
  const [wsService, setWsService] =
    useState<AvailabilityWebSocketService | null>(null);
  const setItemAvailability = useMenuAvailabilityStore(
    (state) => state.setItemAvailability
  );

  useEffect(() => {
    // Initialize availability data
    initializeAvailability();

    // Set up WebSocket for real-time updates
    const token = localStorage.getItem("token");
    if (token) {
      const ws = new AvailabilityWebSocketService(
        token,
        handleAvailabilityNotification
      );
      ws.connect();
      setWsService(ws);
    }

    return () => {
      if (wsService) {
        wsService.disconnect();
      }
    };
  }, []);

  const initializeAvailability = async () => {
    try {
      const response = await fetch("/api/v1/menu/items");
      const data = await response.json();

      if (data.success) {
        data.data.items.forEach((item: any) => {
          setItemAvailability(item.id, item.available);
        });
      }
    } catch (error) {
      console.error("Failed to initialize availability:", error);
    }
  };

  const handleAvailabilityNotification = (data: {
    title: string;
    itemName: string;
    available: boolean;
    itemId: string;
    timestamp: string;
  }) => {
    // Add notification to the queue
    if ((window as any).addNotification) {
      (window as any).addNotification({
        title: data.title,
        message: `${data.itemName} is now ${
          data.available ? "available" : "out of stock"
        }`,
        type: data.available ? "success" : "warning",
      });
    }

    // You can also trigger other actions here
    console.log("Availability changed:", data);
  };

  return (
    <NotificationManager>
      {/* Your app components */}
      <div className="app">
        <h1>Restaurant POS System</h1>
        {/* Other components */}
      </div>
    </NotificationManager>
  );
}

export default App;
```

## 4. Usage in Different Components

### Menu Management Component

```tsx
// components/MenuManagement.tsx
import React, { useState, useEffect } from "react";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

const MenuManagement: React.FC = () => {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const isItemAvailable = useMenuAvailabilityStore(
    (state) => state.isItemAvailable
  );
  const setItemAvailability = useMenuAvailabilityStore(
    (state) => state.setItemAvailability
  );

  const handleAvailabilityToggle = async (
    itemId: string,
    newAvailable: boolean
  ) => {
    try {
      const response = await fetch(
        `/api/v1/menu/items/${itemId}/availability`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ available: newAvailable }),
        }
      );

      if (response.ok) {
        // Update local state
        setItemAvailability(itemId, newAvailable);

        // Show success notification
        if ((window as any).addNotification) {
          (window as any).addNotification({
            title: "Availability Updated",
            message: "Menu item availability has been updated successfully",
            type: "success",
          });
        }
      }
    } catch (error) {
      console.error("Failed to update availability:", error);

      // Show error notification
      if ((window as any).addNotification) {
        (window as any).addNotification({
          title: "Update Failed",
          message: "Failed to update menu item availability",
          type: "error",
        });
      }
    }
  };

  return (
    <div className="menu-management">
      <h2>Menu Management</h2>
      <div className="menu-items">
        {menuItems.map((item) => (
          <div key={item.id} className="menu-item">
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <p>Price: ${item.price}</p>

            <div className="availability-controls">
              <span
                className={`status ${
                  isItemAvailable(item.id) ? "available" : "unavailable"
                }`}
              >
                {isItemAvailable(item.id) ? "✅ Available" : "❌ Out of Stock"}
              </span>

              <button
                onClick={() =>
                  handleAvailabilityToggle(item.id, !isItemAvailable(item.id))
                }
                className={`toggle-btn ${
                  isItemAvailable(item.id) ? "available" : "unavailable"
                }`}
              >
                Toggle Availability
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MenuManagement;
```

### Order Taking Component

```tsx
// components/OrderTaking.tsx
import React, { useState, useEffect } from "react";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

const OrderTaking: React.FC = () => {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(
    new Map()
  );
  const isItemAvailable = useMenuAvailabilityStore(
    (state) => state.isItemAvailable
  );

  // Filter to show only available items
  const availableItems = menuItems.filter((item) => isItemAvailable(item.id));

  const addToOrder = (itemId: string) => {
    if (!isItemAvailable(itemId)) {
      // Show warning notification
      if ((window as any).addNotification) {
        (window as any).addNotification({
          title: "Item Unavailable",
          message: "This item is currently out of stock",
          type: "warning",
        });
      }
      return;
    }

    const currentQuantity = selectedItems.get(itemId) || 0;
    setSelectedItems(new Map(selectedItems.set(itemId, currentQuantity + 1)));
  };

  return (
    <div className="order-taking">
      <h2>Take Order</h2>

      {/* Show availability status */}
      <div className="availability-summary">
        <p>
          {availableItems.length} of {menuItems.length} items available
        </p>
      </div>

      <div className="menu-items">
        {availableItems.map((item) => (
          <div
            key={item.id}
            className="menu-item"
            onClick={() => addToOrder(item.id)}
          >
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <p>Price: ${item.price}</p>
            <span className="status available">✅ Available</span>
          </div>
        ))}
      </div>

      {/* Order summary */}
      <div className="order-summary">
        <h3>Order Summary</h3>
        {Array.from(selectedItems.entries()).map(([itemId, quantity]) => {
          const item = menuItems.find((i) => i.id === itemId);
          return (
            <div key={itemId} className="order-item">
              <span>{item?.name}</span>
              <span>Qty: {quantity}</span>
              <span>${(item?.price || 0) * quantity}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderTaking;
```

## 5. CSS Styling

```css
/* Notification Styles */
.notification-toast {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 50;
  max-width: 24rem;
  width: 100%;
  border-radius: 0.5rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.notification-toast.enter {
  opacity: 0;
  transform: translateX(100%);
}

.notification-toast.enter-active {
  opacity: 1;
  transform: translateX(0);
}

.notification-toast.exit {
  opacity: 1;
  transform: translateX(0);
}

.notification-toast.exit-active {
  opacity: 0;
  transform: translateX(100%);
}

/* Menu Item Styles */
.menu-item {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.menu-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}

.status {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.status.available {
  background-color: #dcfce7;
  color: #166534;
}

.status.unavailable {
  background-color: #fee2e2;
  color: #991b1b;
}

.toggle-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.toggle-btn.available {
  background-color: #10b981;
  color: white;
}

.toggle-btn.unavailable {
  background-color: #ef4444;
  color: white;
}

.toggle-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

## 6. Testing the Notifications

### Test Component

```tsx
// components/TestNotifications.tsx
import React from "react";

const TestNotifications: React.FC = () => {
  const testNotifications = () => {
    if ((window as any).addNotification) {
      // Test success notification
      (window as any).addNotification({
        title: "Test Success",
        message: "This is a test success notification",
        type: "success",
      });

      // Test warning notification
      setTimeout(() => {
        (window as any).addNotification({
          title: "Test Warning",
          message: "This is a test warning notification",
          type: "warning",
        });
      }, 1000);

      // Test error notification
      setTimeout(() => {
        (window as any).addNotification({
          title: "Test Error",
          message: "This is a test error notification",
          type: "error",
        });
      }, 2000);
    }
  };

  return (
    <div className="test-notifications">
      <h3>Test Notifications</h3>
      <button onClick={testNotifications} className="test-btn">
        Test All Notification Types
      </button>
    </div>
  );
};

export default TestNotifications;
```

## 7. Best Practices

1. **Error Handling**: Always wrap WebSocket operations in try-catch blocks
2. **Connection Management**: Handle reconnection logic for network issues
3. **Performance**: Debounce rapid availability changes to avoid spam
4. **Accessibility**: Ensure notifications are screen reader friendly
5. **Mobile**: Design notifications to work well on mobile devices
6. **Testing**: Test notifications in different network conditions

## 8. Troubleshooting

### Common Issues:

- **WebSocket not connecting**: Check server URL and authentication
- **Notifications not showing**: Verify NotificationManager is wrapping your app
- **Availability not updating**: Check if the store is properly connected
- **Multiple notifications**: Ensure proper cleanup of event listeners

### Debug Mode:

```tsx
// Enable debug logging
const ws = new AvailabilityWebSocketService(token, handleNotification);
ws.connect();

// Check connection status
console.log("WebSocket connected:", ws.isConnected());
```

This guide provides everything you need to integrate real-time menu item availability notifications into your frontend application! 🚀
