# Kitchen Availability Management - Frontend Implementation Guide

## Overview

This guide covers the API endpoints needed to build a kitchen screen where chefs can view all menu items and quickly toggle their availability status.

## Required API Endpoints

### 1. Get All Menu Items (Kitchen View)

**GET** `/api/menu/items`

**Purpose**: Fetch all menu items for the kitchen display, including availability status.

**Authentication**: Required (Bearer token with TENANT_ADMIN or MANAGER role)

**Response Structure**:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "item_123",
        "name": "Margherita Pizza",
        "description": "Classic tomato and mozzarella",
        "price": 14.99,
        "category": "Pizza",
        "categoryId": "cat_456",
        "image": "pizza.jpg",
        "isActive": true,
        "available": true,  // ← This is the key field for kitchen
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z",
        "ingredients": [...],
        "allergens": [...],
        "tags": [...]
      }
    ]
  }
}
```

**Frontend Usage**: Use this to populate your kitchen dashboard with all menu items and their current availability status.

---

### 2. Toggle Item Availability (Quick Toggle)

**PATCH** `/api/menu/items/:id/availability`

**Purpose**: Quickly toggle a menu item's availability status (in stock/out of stock).

**Authentication**: Required (Bearer token with TENANT_ADMIN or MANAGER role)

**Request Body**:

```json
{
  "available": false // true = in stock, false = out of stock
}
```

**Response**: Returns the updated menu item with all details.

**Frontend Usage**: Use this for the quick toggle buttons in your kitchen interface.

---

### 3. Update Menu Item (Full Update)

**PUT** `/api/menu/items/:id`

**Purpose**: Update any menu item details, including availability (optional field).

**Authentication**: Required (Bearer token with TENANT_ADMIN or MANAGER role)

**Request Body** (all fields optional):

```json
{
  "name": "Updated Name",
  "price": 15.99,
  "available": false, // ← Optional: include if you want to change availability
  "description": "Updated description"
}
```

**Frontend Usage**: Use this if you want to update availability along with other item details.

---

## Frontend Implementation Examples

### Kitchen Dashboard Component

```typescript
// Example React component for kitchen availability management
interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  image?: string;
}

const KitchenDashboard: React.FC = () => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all menu items
  const fetchMenuItems = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/menu/items", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();
      setMenuItems(data.data.items);
    } catch (error) {
      console.error("Failed to fetch menu items:", error);
    } finally {
      setLoading(false);
    }
  };

  // Quick toggle availability
  const toggleAvailability = async (itemId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/menu/items/${itemId}/availability`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          available: !currentStatus,
        }),
      });

      if (response.ok) {
        // Update local state
        setMenuItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, available: !currentStatus } : item
          )
        );
      }
    } catch (error) {
      console.error("Failed to toggle availability:", error);
    }
  };

  return (
    <div className="kitchen-dashboard">
      <h1>Kitchen Management</h1>

      {loading ? (
        <div>Loading menu items...</div>
      ) : (
        <div className="menu-grid">
          {menuItems.map((item) => (
            <div
              key={item.id}
              className={`menu-item ${!item.available ? "out-of-stock" : ""}`}
            >
              <img src={item.image} alt={item.name} />
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <p className="price">${item.price}</p>
              <p className="category">{item.category}</p>

              {/* Availability Toggle */}
              <button
                className={`availability-toggle ${
                  item.available ? "available" : "unavailable"
                }`}
                onClick={() => toggleAvailability(item.id, item.available)}
              >
                {item.available ? "✅ In Stock" : "❌ Out of Stock"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### CSS Styling for Kitchen Interface

```css
.kitchen-dashboard {
  padding: 20px;
  background: #f5f5f5;
}

.menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.menu-item {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.menu-item.out-of-stock {
  opacity: 0.6;
  background: #f8f8f8;
}

.availability-toggle {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
}

.availability-toggle.available {
  background: #4caf50;
  color: white;
}

.availability-toggle.unavailable {
  background: #f44336;
  color: white;
}

.availability-toggle:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}
```

---

## User Experience Recommendations

### 1. Visual Indicators

- **Green/Checkmark**: Item is available
- **Red/X**: Item is out of stock
- **Greyed out**: Out-of-stock items should be visually distinct
- **Hover effects**: Show current status on hover

### 2. Quick Actions

- **One-click toggle**: Single button to switch availability
- **Confirmation**: Optional confirmation dialog for critical items
- **Real-time updates**: Update UI immediately after successful API call

### 3. Kitchen Workflow

- **Category grouping**: Group items by category for easier management
- **Search/filter**: Allow chefs to quickly find specific items
- **Bulk actions**: Consider bulk availability updates for multiple items

### 4. Error Handling

- **Network errors**: Show retry options
- **Permission errors**: Clear messaging for unauthorized actions
- **Validation errors**: Helpful error messages for invalid data

---

## Testing Checklist

- [ ] Fetch menu items displays correctly
- [ ] Availability status shows properly
- [ ] Toggle button works for each item
- [ ] UI updates immediately after toggle
- [ ] Error handling works for network issues
- [ ] Permission checks work correctly
- [ ] Responsive design on different screen sizes
- [ ] Loading states display properly

---

## Security Notes

- All endpoints require authentication
- Only TENANT_ADMIN and MANAGER roles can modify availability
- Validate all user inputs on frontend
- Implement proper error boundaries
- Log all availability changes for audit purposes

---

## Performance Considerations

- Implement pagination if you have many menu items
- Use optimistic updates for better UX
- Cache menu items data when possible
- Debounce rapid toggle requests
- Consider real-time updates via WebSocket for multi-user scenarios

---

## Support

If you encounter any issues with these endpoints, check:

1. Authentication token validity
2. User role permissions
3. Network connectivity
4. API response status codes
5. Console error messages

For additional help, refer to the main API documentation or contact the backend team.
