# Kitchen API Guide

This guide covers the new kitchen functionality that allows kitchen staff to manage order items and track their cooking status.

## Database Changes

### New Status Field in orderItems Table

The `orderItems` table now includes a `status` field with the following values:

- `pending` - Item is not cooked yet (default)
- `cooked` - Item has been cooked and is ready

### Database Migration

Run the following SQL to add the status field:

```sql
-- Add status field to orderItems table for kitchen management
ALTER TABLE "orderItems"
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'cooked'));

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orderitems_status ON "orderItems" (status);
CREATE INDEX IF NOT EXISTS idx_orderitems_order_status ON "orderItems" ("orderId", status);

-- Update existing order items to have 'pending' status
UPDATE "orderItems" SET status = 'pending' WHERE status IS NULL;
```

## Kitchen API Endpoints

### 1. Get Kitchen Orders Overview

**Endpoint:** `GET /api/v1/kitchen/orders`

**Description:** Get all active orders with item status counts for kitchen management.

**Authentication:** Required (KITCHEN, MANAGER, TENANT_ADMIN roles)

**Query Parameters:**

- `status` (optional): Filter by item status (`pending`, `cooked`, or `all`)

**Response:**

```json
{
  "success": true,
  "message": "Kitchen orders retrieved successfully",
  "data": {
    "orders": [
      {
        "id": "order_id",
        "orderNumber": "ORD-001",
        "tableNumber": "T1",
        "orderStatus": "active",
        "customerName": "John Doe",
        "customerPhone": "+1234567890",
        "createdAt": "2024-01-01T12:00:00Z",
        "itemCounts": {
          "total": 3,
          "pending": 2,
          "cooked": 1
        }
      }
    ]
  }
}
```

### 2. Get Detailed Order for Kitchen

**Endpoint:** `GET /api/v1/kitchen/orders/:orderId`

**Description:** Get detailed order information with all items and their current status.

**Authentication:** Required (KITCHEN, MANAGER, TENANT_ADMIN roles)

**Response:**

```json
{
  "success": true,
  "message": "Order details retrieved successfully",
  "data": {
    "order": {
      "id": "order_id",
      "orderNumber": "ORD-001",
      "tableNumber": "T1",
      "status": "active",
      "customerName": "John Doe",
      "customerPhone": "+1234567890",
      "createdAt": "2024-01-01T12:00:00Z",
      "itemCounts": {
        "total": 3,
        "pending": 2,
        "cooked": 1
      },
      "items": [
        {
          "id": "item_id",
          "menuItemId": "menu_item_id",
          "menuItemName": "Margherita Pizza",
          "menuItemDescription": "Fresh mozzarella, tomato sauce, basil",
          "categoryName": "Pizza",
          "quantity": 1,
          "unitPrice": 12.99,
          "totalPrice": 12.99,
          "notes": "Extra cheese",
          "status": "pending",
          "createdAt": "2024-01-01T12:00:00Z"
        }
      ]
    }
  }
}
```

### 3. Update Item Cooking Status

**Endpoint:** `PUT /api/v1/kitchen/orders/:orderId/items/:itemId/status`

**Description:** Update the cooking status of a specific order item.

**Authentication:** Required (KITCHEN, MANAGER, TENANT_ADMIN roles)

**Request Body:**

```json
{
  "status": "cooking",
  "notes": "Started preparing the pizza"
}
```

**Status Values:**

- `pending` - Item is not cooked yet
- `cooked` - Item has been cooked and is ready

**Response:**

```json
{
  "success": true,
  "message": "Item status updated successfully",
  "data": {
    "item": {
      "id": "item_id",
      "menuItemId": "menu_item_id",
      "menuItemName": "Margherita Pizza",
      "quantity": 1,
      "unitPrice": 12.99,
      "totalPrice": 12.99,
      "notes": "Started preparing the pizza",
      "status": "cooking",
      "updatedAt": "2024-01-01T12:05:00Z"
    },
    "message": "Item status updated to cooking"
  }
}
```

### 4. Kitchen Dashboard

**Endpoint:** `GET /api/v1/kitchen/dashboard`

**Description:** Get kitchen overview with statistics and recent orders that need attention.

**Authentication:** Required (KITCHEN, MANAGER, TENANT_ADMIN roles)

**Response:**

```json
{
  "success": true,
  "message": "Kitchen dashboard retrieved successfully",
  "data": {
    "dashboard": {
      "statistics": {
        "activeOrders": 5,
        "pendingItems": 8,
        "cookedItems": 2
      },
      "recentOrders": [
        {
          "id": "order_id",
          "orderNumber": "ORD-001",
          "tableNumber": "T1",
          "createdAt": "2024-01-01T12:00:00Z",
          "pendingCount": 2
        }
      ]
    }
  }
}
```

## Existing Updated Endpoint

### Update Order Item Status (Legacy)

**Endpoint:** `PUT /api/v1/orders/:id/items/:itemId`

**Description:** This existing endpoint has been updated to actually save the status to the database instead of just returning a formatted response.

**Status Values:** Now supports kitchen-specific statuses (`pending`, `cooked`)

## Workflow Examples

### 1. New Order Arrives

1. Order is created with all items having `status: "pending"`
2. Kitchen staff can see new orders via `/api/v1/kitchen/orders`
3. Kitchen staff can view order details via `/api/v1/kitchen/orders/:orderId`

### 2. Kitchen Cooks Item

1. Kitchen staff updates item status to `"cooked"` via status update endpoint
2. Item appears in "cooked" section of dashboard
3. Wait staff can see which items are ready to serve

## Integration with Existing System

- **WebSocket Notifications:** Existing WebSocket events will continue to work
- **Order Management:** All existing order endpoints remain functional
- **Role-Based Access:** Kitchen staff need `KITCHEN` role to access these endpoints
- **Tenant Isolation:** All endpoints respect tenant isolation via `tenantMiddleware`

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human readable error message",
  "statusCode": 400
}
```

Common error codes:

- `VALIDATION_ERROR` - Invalid input data
- `NOT_FOUND` - Order or item not found
- `UPDATE_ERROR` - Failed to update database
- `FETCH_ERROR` - Failed to retrieve data

## Performance Considerations

- Database indexes have been added for `status` and `orderId + status` combinations
- Queries use efficient JOINs and aggregations
- Dashboard statistics are calculated in a single query
- Pagination can be added for large order volumes if needed

## Security

- All endpoints require authentication
- Role-based access control (KITCHEN, MANAGER, TENANT_ADMIN)
- Tenant isolation prevents cross-tenant access
- Input validation for all status values
- SQL injection protection via parameterized queries
