# Complete Deliveroo Integration for TapTab POS

This document describes the comprehensive Deliveroo integration for the TapTab Restaurant POS system, implementing all major Deliveroo APIs based on the [official documentation](https://api-docs.deliveroo.com/docs/introduction).

## 🎯 **Features Implemented**

### **1. Order API** - Complete order management
- ✅ **Get orders** from Deliveroo
- ✅ **Get specific order** details
- ✅ **Update order status** (sync with Deliveroo)
- ✅ **Webhook processing** for real-time orders
- ✅ **Order synchronization** between systems

### **2. Menu API** - Menu management
- ✅ **Get menu categories** from Deliveroo
- ✅ **Create/Update/Delete** menu categories
- ✅ **Get menu items** from Deliveroo
- ✅ **Create/Update/Delete** menu items
- ✅ **Menu synchronization** (POS → Deliveroo)

### **3. Site API** - Restaurant management
- ✅ **Get site information** (status, hours, etc.)
- ✅ **Update site status** (open/closed/busy)
- ✅ **Update opening hours**
- ✅ **Update workload mode**

### **4. Authentication & Security**
- ✅ **OAuth 2.0** client credentials flow
- ✅ **Automatic token refresh**
- ✅ **Secure credential storage**

## 🔧 **Setup Instructions**

### **1. Environment Variables**
Add these to your `.env` file:
```env
# Deliveroo API Configuration
DELIVEROO_CLIENT_ID=7uidsu5ml230ha8u4dbp3uu81n
DELIVEROO_CLIENT_SECRET=famnfdf6evi7mr5km6pouevnnvrgh3cb76f05iv40piju4olacg
DELIVEROO_API_URL=https://api.deliveroo.com/v1
DELIVEROO_TENANT_ID=your_tenant_id_here
```

### **2. Database Migration**
Run the migration to add Deliveroo fields:
```bash
psql your_database_name -f migrations/add_user_order_source.sql
```

## 📋 **API Endpoints**

### **Webhook Endpoints**

#### **POST** `/api/v1/deliveroo/webhook`
Handles real-time order updates from Deliveroo.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "event": "order.accepted",
  "order_id": "del_123456",
  "order": {
    "id": "del_123456",
    "reference": "DEL-123456",
    "status": "accepted",
    "customer": {
      "name": "John Doe",
      "phone": "+1234567890",
      "address": "123 Main St, City"
    },
    "items": [
      {
        "id": "item_1",
        "name": "Burger",
        "quantity": 2,
        "price": 12.99,
        "notes": "Extra cheese"
      }
    ],
    "total": {
      "amount": 25.98,
      "currency": "USD"
    },
    "fulfillment_type": "delivery",
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z",
    "estimated_delivery_time": "2024-01-01T12:30:00Z",
    "special_instructions": "Ring doorbell twice"
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### **Order API Endpoints**

#### **GET** `/api/v1/deliveroo/orders`
Get orders from Deliveroo.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `status` (optional): Filter by status
- `limit` (optional): Number of orders (default: 50)

**Response:**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "del_123456",
        "reference": "DEL-123456",
        "status": "accepted",
        "customer": {
          "name": "John Doe",
          "phone": "+1234567890",
          "address": "123 Main St, City"
        },
        "items": [...],
        "total": {
          "amount": 25.98,
          "currency": "USD"
        },
        "fulfillment_type": "delivery",
        "created_at": "2024-01-01T12:00:00Z",
        "updated_at": "2024-01-01T12:00:00Z"
      }
    ]
  }
}
```

#### **GET** `/api/v1/deliveroo/orders/:orderId`
Get specific order details.

#### **PUT** `/api/v1/deliveroo/orders/:orderId/status`
Update order status on Deliveroo.

**Request Body:**
```json
{
  "status": "confirmed"
}
```

### **Menu API Endpoints**

#### **GET** `/api/v1/deliveroo/menu/categories`
Get menu categories from Deliveroo.

#### **POST** `/api/v1/deliveroo/menu/categories`
Create menu category on Deliveroo.

**Request Body:**
```json
{
  "name": "Appetizers",
  "description": "Start your meal right",
  "sort_order": 1
}
```

#### **PUT** `/api/v1/deliveroo/menu/categories/:categoryId`
Update menu category.

#### **DELETE** `/api/v1/deliveroo/menu/categories/:categoryId`
Delete menu category.

#### **GET** `/api/v1/deliveroo/menu/items`
Get menu items from Deliveroo.

**Query Parameters:**
- `categoryId` (optional): Filter by category

#### **POST** `/api/v1/deliveroo/menu/items`
Create menu item on Deliveroo.

**Request Body:**
```json
{
  "name": "Margherita Pizza",
  "description": "Fresh mozzarella, tomato sauce, basil",
  "price": 12.99,
  "category_id": "cat_123",
  "image_url": "https://example.com/pizza.jpg",
  "allergens": ["dairy", "gluten"],
  "available": true,
  "pos_id": "item_123"
}
```

#### **PUT** `/api/v1/deliveroo/menu/items/:itemId`
Update menu item.

#### **DELETE** `/api/v1/deliveroo/menu/items/:itemId`
Delete menu item.

### **Site API Endpoints**

#### **GET** `/api/v1/deliveroo/site`
Get site information.

**Response:**
```json
{
  "success": true,
  "data": {
    "site": {
      "id": "site_123",
      "name": "Restaurant Name",
      "status": "open",
      "opening_hours": [
        {
          "day": 1,
          "open_time": "09:00",
          "close_time": "22:00",
          "closed": false
        }
      ],
      "workload_mode": "normal"
    }
  }
}
```

#### **PUT** `/api/v1/deliveroo/site/status`
Update site status.

**Request Body:**
```json
{
  "status": "open"
}
```

#### **PUT** `/api/v1/deliveroo/site/opening-hours`
Update opening hours.

**Request Body:**
```json
{
  "opening_hours": [
    {
      "day": 1,
      "open_time": "09:00",
      "close_time": "22:00",
      "closed": false
    },
    {
      "day": 2,
      "open_time": "09:00",
      "close_time": "22:00",
      "closed": false
    }
  ]
}
```

#### **PUT** `/api/v1/deliveroo/site/workload-mode`
Update workload mode.

**Request Body:**
```json
{
  "mode": "busy"
}
```

### **Sync Endpoints**

#### **POST** `/api/v1/deliveroo/sync/orders`
Sync orders from Deliveroo to your POS.

**Request Body:**
```json
{
  "status": "accepted"
}
```

#### **POST** `/api/v1/deliveroo/sync/menu`
Sync your menu to Deliveroo.

## 🔄 **Order Flow**

### **1. Order Reception**
1. **Deliveroo** sends webhook to `/api/v1/deliveroo/webhook`
2. **System** creates order in your database
3. **WebSocket** notification sent to staff
4. **Order** appears in your POS system

### **2. Order Processing**
1. **Kitchen** updates order status in your POS
2. **System** automatically updates status on Deliveroo
3. **Real-time** synchronization between systems

### **3. Order Completion**
1. **Status** updates sync to Deliveroo
2. **Customer** gets notified via Deliveroo
3. **Analytics** tracked in both systems

## 📊 **Menu Synchronization**

### **One-Way Sync (POS → Deliveroo)**
- **Categories**: Automatically created/updated
- **Items**: Sync with images, prices, allergens
- **Availability**: Real-time stock updates
- **Pricing**: Automatic price synchronization

### **Menu Management**
- **Create** categories and items via API
- **Update** menu items in real-time
- **Delete** items when discontinued
- **Bulk** operations supported

## 🏪 **Site Management**

### **Status Control**
- **Open/Closed/Busy** status updates
- **Real-time** status synchronization
- **Automatic** status management

### **Opening Hours**
- **Flexible** hours per day
- **Special** hours for holidays
- **Automatic** opening/closing

### **Workload Mode**
- **Normal/Busy** mode management
- **Capacity** control
- **Order** acceptance control

## 🔐 **Security Features**

### **Authentication**
- **OAuth 2.0** client credentials
- **Automatic** token refresh
- **Secure** credential storage

### **Webhook Security**
- **Signature** verification (implement as needed)
- **HTTPS** required
- **Rate limiting** protection

## 📈 **Analytics & Reporting**

### **Order Analytics**
```sql
-- Orders by source
SELECT "orderSource", COUNT(*) as orders, SUM("finalAmount") as revenue
FROM orders 
WHERE "tenantId" = $1 
GROUP BY "orderSource";

-- Deliveroo specific analytics
SELECT 
  DATE("createdAt") as date,
  COUNT(*) as orders,
  SUM("finalAmount") as revenue,
  AVG("finalAmount") as avg_order_value
FROM orders 
WHERE "orderSource" = 'DELIVEROO' 
  AND "tenantId" = $1
GROUP BY DATE("createdAt")
ORDER BY date DESC;
```

### **Menu Performance**
- **Popular items** on Deliveroo
- **Category performance** analysis
- **Price optimization** insights

## 🚀 **Frontend Integration**

### **React/Vue Components**
```javascript
// Get Deliveroo orders
const fetchDeliverooOrders = async () => {
  const response = await fetch('/api/v1/deliveroo/orders', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.data.orders;
};

// Update order status
const updateOrderStatus = async (orderId, status) => {
  const response = await fetch(`/api/v1/deliveroo/orders/${orderId}/status`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status })
  });
  return response.json();
};

// Sync menu to Deliveroo
const syncMenuToDeliveroo = async () => {
  const response = await fetch('/api/v1/deliveroo/sync/menu', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

## 🛠️ **Configuration**

### **Webhook Setup**
1. **Set webhook URL** in Deliveroo dashboard:
   ```
   https://your-domain.com/api/v1/deliveroo/webhook
   ```
2. **Configure** event types (orders, status updates)
3. **Test** webhook connectivity

### **Menu Sync**
1. **Run initial sync**: `POST /api/v1/deliveroo/sync/menu`
2. **Set up automatic sync** (cron job)
3. **Monitor** sync status

### **Site Configuration**
1. **Set opening hours** via API
2. **Configure** workload modes
3. **Test** status updates

## 📝 **Error Handling**

### **Common Errors**
```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_ERROR",
    "message": "Invalid Deliveroo credentials"
  }
}
```

### **Webhook Errors**
```json
{
  "success": false,
  "error": {
    "code": "WEBHOOK_ERROR",
    "message": "Failed to process webhook"
  }
}
```

## 🔧 **Troubleshooting**

### **Authentication Issues**
1. **Check** client ID and secret
2. **Verify** API URL is correct
3. **Test** token refresh

### **Webhook Issues**
1. **Verify** webhook URL is accessible
2. **Check** signature verification
3. **Monitor** webhook logs

### **Sync Issues**
1. **Check** API rate limits
2. **Verify** menu item mappings
3. **Monitor** sync logs

## 🎯 **Next Steps**

1. **Test** all endpoints with your credentials
2. **Configure** webhook URL in Deliveroo dashboard
3. **Set up** menu synchronization
4. **Implement** frontend integration
5. **Monitor** order flow and analytics

This integration provides a complete solution for managing your restaurant's presence on Deliveroo, from order management to menu synchronization and site configuration. 