# Frontend Menu Item Availability Toggle Guide

## Overview

This guide shows how to implement the menu item availability toggle in your frontend application using the `PATCH /api/v1/menu/items/:id/availability` endpoint.

## API Endpoint

```
PATCH /api/v1/menu/items/:id/availability
Authorization: Bearer {token}
Content-Type: application/json

Body: {
  "available": boolean
}
```

## 1. Basic Toggle Component

### React Component Example

```tsx
import React, { useState } from "react";

interface MenuItemAvailabilityToggleProps {
  menuItemId: string;
  initialAvailable: boolean;
  onToggle: (available: boolean) => void;
  disabled?: boolean;
}

const MenuItemAvailabilityToggle: React.FC<MenuItemAvailabilityToggleProps> = ({
  menuItemId,
  initialAvailable,
  onToggle,
  disabled = false,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [available, setAvailable] = useState(initialAvailable);

  const handleToggle = async () => {
    if (isLoading || disabled) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/v1/menu/items/${menuItemId}/availability`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ available: !available }),
        }
      );

      if (response.ok) {
        const newAvailable = !available;
        setAvailable(newAvailable);
        onToggle(newAvailable);
      } else {
        throw new Error("Failed to update availability");
      }
    } catch (error) {
      console.error("Error updating availability:", error);
      // Revert the toggle on error
      setAvailable(available);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={disabled || isLoading}
      className={`availability-toggle ${
        available ? "available" : "unavailable"
      } ${isLoading ? "loading" : ""}`}
    >
      {isLoading ? (
        <span className="spinner">⏳</span>
      ) : (
        <span className="status">
          {available ? "✅ Available" : "❌ Out of Stock"}
        </span>
      )}
    </button>
  );
};

export default MenuItemAvailabilityToggle;
```

## 2. Advanced Toggle with Confirmation

```tsx
import React, { useState } from "react";

const AdvancedAvailabilityToggle: React.FC<{
  menuItemId: string;
  menuItemName: string;
  initialAvailable: boolean;
  onToggle: (available: boolean) => void;
}> = ({ menuItemId, menuItemName, initialAvailable, onToggle }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [available, setAvailable] = useState(initialAvailable);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/v1/menu/items/${menuItemId}/availability`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ available: !available }),
        }
      );

      if (response.ok) {
        const newAvailable = !available;
        setAvailable(newAvailable);
        onToggle(newAvailable);
        setShowConfirm(false);
      } else {
        throw new Error("Failed to update availability");
      }
    } catch (error) {
      console.error("Error updating availability:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="advanced-toggle">
      {showConfirm ? (
        <div className="confirmation-dialog">
          <p>
            Are you sure you want to mark "{menuItemName}" as{" "}
            {available ? "out of stock" : "available"}?
          </p>
          <div className="confirmation-actions">
            <button
              onClick={() => setShowConfirm(false)}
              className="btn-secondary"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleToggle}
              className={`btn-primary ${isLoading ? "loading" : ""}`}
              disabled={isLoading}
            >
              {isLoading ? "Updating..." : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          className={`toggle-btn ${available ? "available" : "unavailable"}`}
        >
          {available ? "✅ Available" : "❌ Out of Stock"}
        </button>
      )}
    </div>
  );
};
```

## 3. Bulk Availability Management

```tsx
import React, { useState } from "react";

interface MenuItem {
  id: string;
  name: string;
  available: boolean;
}

const BulkAvailabilityManager: React.FC<{
  menuItems: MenuItem[];
  onBulkUpdate: (updates: { id: string; available: boolean }[]) => void;
}> = ({ menuItems, onBulkUpdate }) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [targetAvailability, setTargetAvailability] = useState<boolean | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleBulkUpdate = async () => {
    if (selectedItems.size === 0 || targetAvailability === null) return;

    setIsLoading(true);
    try {
      const updates = Array.from(selectedItems).map((id) => ({
        id,
        available: targetAvailability,
      }));

      // Update each item individually (or implement batch endpoint)
      await Promise.all(
        updates.map((update) =>
          fetch(`/api/v1/menu/items/${update.id}/availability`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ available: update.available }),
          })
        )
      );

      onBulkUpdate(updates);
      setSelectedItems(new Set());
      setTargetAvailability(null);
    } catch (error) {
      console.error("Bulk update failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bulk-availability-manager">
      <div className="bulk-controls">
        <select
          value={
            targetAvailability === null ? "" : targetAvailability.toString()
          }
          onChange={(e) =>
            setTargetAvailability(
              e.target.value === "" ? null : e.target.value === "true"
            )
          }
        >
          <option value="">Select action...</option>
          <option value="true">Mark as Available</option>
          <option value="false">Mark as Out of Stock</option>
        </select>

        <button
          onClick={handleBulkUpdate}
          disabled={
            selectedItems.size === 0 || targetAvailability === null || isLoading
          }
          className="btn-primary"
        >
          {isLoading ? "Updating..." : `Update ${selectedItems.size} items`}
        </button>
      </div>

      <div className="menu-items-list">
        {menuItems.map((item) => (
          <div key={item.id} className="menu-item-row">
            <input
              type="checkbox"
              checked={selectedItems.has(item.id)}
              onChange={(e) => {
                const newSelected = new Set(selectedItems);
                if (e.target.checked) {
                  newSelected.add(item.id);
                } else {
                  newSelected.delete(item.id);
                }
                setSelectedItems(newSelected);
              }}
            />
            <span
              className={`item-name ${!item.available ? "unavailable" : ""}`}
            >
              {item.name}
            </span>
            <span
              className={`status ${
                item.available ? "available" : "unavailable"
              }`}
            >
              {item.available ? "Available" : "Out of Stock"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 4. CSS Styling

```css
/* Basic Toggle Styles */
.availability-toggle {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
  min-width: 120px;
}

.availability-toggle.available {
  background-color: #10b981;
  color: white;
}

.availability-toggle.unavailable {
  background-color: #ef4444;
  color: white;
}

.availability-toggle:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.availability-toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.availability-toggle.loading {
  opacity: 0.8;
  cursor: wait;
}

/* Advanced Toggle Styles */
.advanced-toggle {
  position: relative;
}

.confirmation-dialog {
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  min-width: 300px;
}

.confirmation-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.btn-primary {
  background-color: #3b82f6;
  color: white;
}

.btn-secondary {
  background-color: #6b7280;
  color: white;
}

/* Bulk Manager Styles */
.bulk-availability-manager {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.bulk-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}

.menu-items-list {
  max-height: 400px;
  overflow-y: auto;
}

.menu-item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

.item-name.unavailable {
  text-decoration: line-through;
  color: #6b7280;
}

.status.available {
  color: #10b981;
  font-weight: 500;
}

.status.unavailable {
  color: #ef4444;
  font-weight: 500;
}
```

## 5. Usage Examples

### In a Menu Management Table

```tsx
const MenuManagementTable: React.FC = () => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const handleAvailabilityToggle = (
    menuItemId: string,
    newAvailable: boolean
  ) => {
    setMenuItems((prev) =>
      prev.map((item) =>
        item.id === menuItemId ? { ...item, available: newAvailable } : item
      )
    );
  };

  return (
    <table className="menu-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Category</th>
          <th>Price</th>
          <th>Availability</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {menuItems.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.category}</td>
            <td>${item.price}</td>
            <td>
              <MenuItemAvailabilityToggle
                menuItemId={item.id}
                initialAvailable={item.available}
                onToggle={(available) =>
                  handleAvailabilityToggle(item.id, available)
                }
              />
            </td>
            <td>{/* Other actions */}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

### In a Kitchen Display

```tsx
const KitchenDisplay: React.FC = () => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  return (
    <div className="kitchen-display">
      <h2>Menu Item Status</h2>
      <div className="status-grid">
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`status-card ${
              item.available ? "available" : "unavailable"
            }`}
          >
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <MenuItemAvailabilityToggle
              menuItemId={item.id}
              initialAvailable={item.available}
              onToggle={(available) => {
                // Update local state
                setMenuItems((prev) =>
                  prev.map((menuItem) =>
                    menuItem.id === item.id
                      ? { ...menuItem, available }
                      : menuItem
                  )
                );
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
```

## 6. Best Practices

1. **Optimistic Updates**: Update the UI immediately, then sync with the server
2. **Error Handling**: Always provide fallback behavior if the API call fails
3. **Loading States**: Show loading indicators during API calls
4. **Confirmation**: Use confirmation dialogs for critical actions
5. **Real-time Updates**: Consider WebSocket integration for live updates
6. **Accessibility**: Ensure keyboard navigation and screen reader support
7. **Mobile Responsiveness**: Design for touch interfaces

## 7. Error Handling

```tsx
const handleToggleWithErrorHandling = async (
  menuItemId: string,
  newAvailable: boolean
) => {
  try {
    const response = await fetch(
      `/api/v1/menu/items/${menuItemId}/availability`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ available: newAvailable }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to update availability");
    }

    // Success - update local state
    onToggle(newAvailable);

    // Show success notification
    showNotification(
      "success",
      `Item marked as ${newAvailable ? "available" : "out of stock"}`
    );
  } catch (error) {
    // Show error notification
    showNotification(
      "error",
      `Failed to update availability: ${error.message}`
    );

    // Revert the toggle
    setAvailable(!newAvailable);
  }
};
```

This guide provides a solid foundation for implementing menu item availability toggles in your frontend application. The components are designed to be reusable, accessible, and provide a smooth user experience.
