# Main Webapp Availability Integration Guide

## Overview

Integrate menu item availability across your entire webapp for order taking, menu views, and public ordering.

## 1. Global Availability State Management

```tsx
// stores/menuAvailabilityStore.ts
import { create } from "zustand";

interface MenuItemAvailability {
  id: string;
  available: boolean;
  lastUpdated: Date;
}

interface MenuAvailabilityStore {
  availabilityMap: Map<string, MenuItemAvailability>;
  setItemAvailability: (id: string, available: boolean) => void;
  isItemAvailable: (id: string) => boolean;
  getAvailableItems: (itemIds: string[]) => string[];
}

export const useMenuAvailabilityStore = create<MenuAvailabilityStore>(
  (set, get) => ({
    availabilityMap: new Map(),

    setItemAvailability: (id: string, available: boolean) => {
      set((state) => {
        const newMap = new Map(state.availabilityMap);
        newMap.set(id, { id, available, lastUpdated: new Date() });
        return { availabilityMap: newMap };
      });
    },

    isItemAvailable: (id: string) => {
      const state = get();
      return state.availabilityMap.get(id)?.available ?? true;
    },

    getAvailableItems: (itemIds: string[]) => {
      const state = get();
      return itemIds.filter((id) => state.isItemAvailable(id));
    },
  })
);
```

## 2. Menu Display with Availability

```tsx
// components/MenuItemCard.tsx
import React from "react";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

const MenuItemCard: React.FC<{
  item: {
    id: string;
    name: string;
    description: string;
    price: number;
    image?: string;
  };
  onAddToOrder: (itemId: string) => void;
}> = ({ item, onAddToOrder }) => {
  const isAvailable = useMenuAvailabilityStore((state) =>
    state.isItemAvailable(item.id)
  );

  return (
    <div className={`menu-item-card ${!isAvailable ? "unavailable" : ""}`}>
      {item.image && (
        <div className="item-image">
          <img src={item.image} alt={item.name} />
          {!isAvailable && (
            <div className="out-of-stock-overlay">
              <span>Out of Stock</span>
            </div>
          )}
        </div>
      )}

      <div className="item-content">
        <h3 className="item-name">{item.name}</h3>
        <p className="item-description">{item.description}</p>
        <p className="item-price">${item.price.toFixed(2)}</p>

        <span
          className={`availability-badge ${
            isAvailable ? "available" : "unavailable"
          }`}
        >
          {isAvailable ? "✅ Available" : "❌ Out of Stock"}
        </span>

        <button
          onClick={() => onAddToOrder(item.id)}
          disabled={!isAvailable}
          className={`add-to-order-btn ${!isAvailable ? "disabled" : ""}`}
        >
          {isAvailable ? "Add to Order" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
};
```

## 3. Order Taking System

```tsx
// components/OrderItemSelector.tsx
const OrderItemSelector: React.FC = () => {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const isItemAvailable = useMenuAvailabilityStore(
    (state) => state.isItemAvailable
  );

  const availableItems = menuItems.filter((item) => isItemAvailable(item.id));

  return (
    <div className="order-item-selector">
      <div className="items-grid">
        {availableItems.map((item) => (
          <div
            key={item.id}
            onClick={() => handleItemClick(item.id)}
            className="order-item-card"
          >
            <h4>{item.name}</h4>
            <p>{item.description}</p>
            <p className="price">${item.price.toFixed(2)}</p>
            <span className="availability-status available">✅ Available</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 4. Public Order Pages

```tsx
// components/PublicMenu.tsx
const PublicMenu: React.FC = () => {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const isItemAvailable = useMenuAvailabilityStore(
    (state) => state.isItemAvailable
  );
  const setItemAvailability = useMenuAvailabilityStore(
    (state) => state.setItemAvailability
  );

  useEffect(() => {
    fetchPublicMenu();
    const interval = setInterval(fetchPublicMenu, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchPublicMenu = async () => {
    const response = await fetch("/api/v1/public/menu/items");
    const data = await response.json();

    if (data.success) {
      setMenuItems(data.data.items);

      // Update availability store
      data.data.items.forEach((item: any) => {
        setItemAvailability(item.id, item.available);
      });
    }
  };

  const availableItems = menuItems.filter((item) => isItemAvailable(item.id));

  return (
    <div className="public-menu">
      <div className="menu-items">
        {availableItems.map((item) => (
          <div key={item.id} className="public-menu-item">
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <p className="price">${item.price.toFixed(2)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 5. Real-time Updates

```tsx
// services/availabilityWebSocket.ts
export class AvailabilityWebSocketService {
  private ws: WebSocket | null = null;

  connect(token: string) {
    this.ws = new WebSocket(`ws://your-domain.com/ws?token=${token}`);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "MENU_ITEM_AVAILABILITY_UPDATE") {
        const { itemId, available } = data.payload;
        useMenuAvailabilityStore
          .getState()
          .setItemAvailability(itemId, available);
      }
    };
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}
```

## 6. CSS for Availability States

```css
.availability-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.availability-badge.available {
  background-color: #10b981;
  color: white;
}

.availability-badge.unavailable {
  background-color: #ef4444;
  color: white;
}

.menu-item-card.unavailable {
  opacity: 0.6;
  filter: grayscale(1);
}

.out-of-stock-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
}

.add-to-order-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

## 7. Integration Points

### App Initialization

```tsx
function App() {
  useEffect(() => {
    // Initialize availability data
    initializeAvailability();

    // Set up WebSocket for real-time updates
    const wsService = new AvailabilityWebSocketService();
    wsService.connect(localStorage.getItem('token') || '');

    return () => wsService.disconnect();
  }, []);

  const initializeAvailability = async () => {
    const response = await fetch('/api/v1/menu/items');
    const data = await response.json();

    if (data.success) {
      data.data.items.forEach((item: any) => {
        useMenuAvailabilityStore.getState().setItemAvailability(item.id, item.available);
      });
    }
  };

  return (/* Your app components */);
}
```

## Key Benefits

✅ **Consistent Experience**: Availability handled uniformly across all components  
✅ **Real-time Updates**: Immediate feedback when items become unavailable  
✅ **Better UX**: Users can't order unavailable items  
✅ **Performance**: Cached availability data reduces API calls  
✅ **Accessibility**: Clear visual indicators for availability status

This integration ensures your entire webapp respects menu item availability, providing a seamless experience for both staff and customers.

      const data = await response.json();

      if (data.success) {
        const availabilityData = data.data.items.map((item: any) => ({
          id: item.id,
          available: item.available,
          lastUpdated: new Date(),
        }));

        setBulkAvailability(availabilityData);
      }
    } catch (error) {
      console.error('Failed to initialize availability:', error);
    }

};

return (
// Your app components
);
}

````

### Route Guards for Availability

```tsx
// hooks/useAvailabilityGuard.ts
import { useEffect, useState } from "react";
import { useMenuAvailabilityStore } from "../stores/menuAvailabilityStore";

export const useAvailabilityGuard = (itemIds: string[]) => {
  const [isChecking, setIsChecking] = useState(true);
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);
  const isItemAvailable = useMenuAvailabilityStore(
    (state) => state.isItemAvailable
  );

  useEffect(() => {
    const checkAvailability = () => {
      const unavailable = itemIds.filter((id) => !isItemAvailable(id));
      setUnavailableItems(unavailable);
      setIsChecking(false);
    };

    checkAvailability();
  }, [itemIds, isItemAvailable]);

  return {
    isChecking,
    unavailableItems,
    hasUnavailableItems: unavailableItems.length > 0,
    allItemsAvailable: unavailableItems.length === 0,
  };
};
````

## 7. Best Practices

1. **Real-time Updates**: Use WebSocket connections for immediate availability changes
2. **Optimistic Updates**: Update UI immediately, then sync with server
3. **Graceful Degradation**: Handle network issues and show appropriate fallbacks
4. **User Feedback**: Clear indicators when items become unavailable
5. **Performance**: Cache availability data and minimize API calls
6. **Accessibility**: Ensure availability status is screen reader friendly
7. **Mobile First**: Design for touch interfaces and small screens

This integration ensures that availability is consistently handled across your entire webapp, providing a seamless experience for both staff and customers.
