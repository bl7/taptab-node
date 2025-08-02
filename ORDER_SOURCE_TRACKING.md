# Order Source Tracking

This document describes the order source tracking feature that allows you to identify how orders were created in your TapTab POS system.

## Overview

Order source tracking helps you understand where orders are coming from:
- **QR Ordering**: Orders placed by customers via QR code
- **Waiter Ordering**: Orders taken by waiters
- **Cashier Ordering**: Orders processed by cashiers
- **Manager Ordering**: Orders created by managers
- **External Platforms**: Orders from delivery platforms (Deliveroo, Uber Eats, etc.)

## Order Source Types

### 1. QR_ORDERING
- **Source**: Customer self-service via QR code
- **Details**: Customer name or "QR Customer"
- **Table**: Regular table number
- **Authentication**: None (public endpoint)

### 2. WAITER_ORDERING
- **Source**: Orders taken by waiters
- **Details**: Waiter's full name
- **Table**: Regular table number
- **Authentication**: JWT token required

### 3. CASHIER_ORDERING
- **Source**: Orders processed by cashiers
- **Details**: Cashier's full name
- **Table**: Regular table number
- **Authentication**: JWT token required

### 4. MANAGER_ORDERING
- **Source**: Orders created by managers
- **Details**: Manager's full name
- **Table**: Regular table number
- **Authentication**: JWT token required



## Database Schema

The `orders` table includes these fields for source tracking:

```sql
-- Order source tracking fields
"orderSource" VARCHAR(50) DEFAULT 'INTERNAL',
"sourceDetails" VARCHAR(255),
```

### Field Descriptions

- **orderSource**: The type of order source (QR_ORDERING, WAITER_ORDERING, etc.)
- **sourceDetails**: Additional details like user name, customer name, etc.

## API Usage

### Creating Orders with Source Tracking

#### QR Ordering (Public)
```bash
POST /api/v1/public/orders
Content-Type: application/json

{
  "tableNumber": "5",
  "items": [
    {
      "menuItemId": "item_123",
      "quantity": 2,
      "notes": "Extra cheese"
    }
  ],
  "customerName": "John Doe",
  "customerPhone": "+1234567890"
}
```

**Result**: `orderSource: "QR_ORDERING"`, `sourceDetails: "John Doe"`

#### Waiter Ordering (Authenticated)
```bash
POST /api/v1/orders
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "tableId": "5",
  "items": [
    {
      "menuItemId": "item_123",
      "quantity": 2,
      "notes": "Extra cheese"
    }
  ],
  "orderSource": "WAITER",
  "customerName": "Jane Smith",
  "customerPhone": "+1234567890"
}
```

**Result**: `orderSource: "WAITER_ORDERING"`, `sourceDetails: "John Waiter"` (waiter's name)

#### Cashier Ordering (Authenticated)
```bash
POST /api/v1/orders
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "tableId": "5",
  "items": [
    {
      "menuItemId": "item_123",
      "quantity": 2
    }
  ],
  "orderSource": "CASHIER"
}
```

**Result**: `orderSource: "CASHIER_ORDERING"`, `sourceDetails: "Mary Cashier"` (cashier's name)

## Querying Orders by Source

### Get All Orders
```bash
GET /api/v1/orders
Authorization: Bearer <jwt_token>
```

### Filter by Source
```bash
GET /api/v1/orders?source=QR_ORDERING
Authorization: Bearer <jwt_token>
```

### Get Orders by Source (Database Query)
```sql
-- Get QR orders
SELECT * FROM orders WHERE "orderSource" = 'QR_ORDERING';

-- Get waiter orders
SELECT * FROM orders WHERE "orderSource" = 'WAITER_ORDERING';

-- Get cashier orders
SELECT * FROM orders WHERE "orderSource" = 'CASHIER_ORDERING';

-- Get manager orders
SELECT * FROM orders WHERE "orderSource" = 'MANAGER_ORDERING';


```

## Response Format

Orders now include source information in the response:

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "order_123",
        "orderNumber": "ORD-1234567890",
        "tableNumber": "5",
        "totalAmount": 25.98,
        "finalAmount": 25.98,
        "status": "pending",
        "waiterId": "user_123",
        "waiterName": "John Waiter",
        "orderSource": "WAITER_ORDERING",
        "sourceDetails": "John Waiter",
        "customerName": "Jane Smith",
        "customerPhone": "+1234567890",
        "items": [...],
        "createdAt": "2024-01-01T12:00:00Z",
        "updatedAt": "2024-01-01T12:00:00Z"
      }
    ]
  }
}
```

## Analytics and Reporting

### Order Source Distribution
```sql
SELECT 
  "orderSource",
  COUNT(*) as order_count,
  SUM("finalAmount") as total_revenue
FROM orders 
WHERE "tenantId" = $1 
  AND "createdAt" >= $2
GROUP BY "orderSource"
ORDER BY order_count DESC;
```

### Revenue by Source
```sql
SELECT 
  "orderSource",
  ROUND(SUM("finalAmount"), 2) as revenue,
  COUNT(*) as orders,
  ROUND(AVG("finalAmount"), 2) as avg_order_value
FROM orders 
WHERE "tenantId" = $1 
  AND "createdAt" >= $2
GROUP BY "orderSource"
ORDER BY revenue DESC;
```

### Popular Items by Source
```sql
SELECT 
  o."orderSource",
  mi.name as item_name,
  SUM(oi.quantity) as total_quantity
FROM orders o
JOIN "orderItems" oi ON o.id = oi."orderId"
JOIN "menuItems" mi ON oi."menuItemId" = mi.id
WHERE o."tenantId" = $1 
  AND o."createdAt" >= $2
GROUP BY o."orderSource", mi.name
ORDER BY o."orderSource", total_quantity DESC;
```

## WebSocket Notifications

Order source information is included in WebSocket notifications:

```javascript
socket.on('newOrder', (data) => {
  console.log('New order received:', data.orderSource);
  console.log('Ordered by:', data.sourceDetails);
  
  if (data.orderSource === 'QR_ORDERING') {
    console.log('QR order from customer:', data.customerName);
  } else if (data.orderSource === 'WAITER_ORDERING') {
    console.log('Waiter order taken by:', data.sourceDetails);

});
```

## Benefits

1. **Analytics**: Understand which channels generate the most orders
2. **Staff Performance**: Track which waiters take the most orders
3. **Customer Behavior**: See how many customers use QR vs waiter service
4. **Revenue Analysis**: Compare revenue from different order sources
5. **Operational Insights**: Optimize staffing based on order patterns

## Migration

If you're upgrading from an existing system, run the migration:

```bash
npm run migrate:deliveroo
```

This will add the `orderSource` and `sourceDetails` fields to your orders table.

## Future Enhancements

- **More Sources**: Add support for other delivery platforms when needed
- **Source Analytics**: Dashboard showing order source trends
- **Staff Performance**: Track individual waiter/cashier performance
- **Customer Segmentation**: Analyze customer preferences by source 