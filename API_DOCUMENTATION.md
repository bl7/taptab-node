# 🍽️ TapTab Restaurant POS API Documentation

## 📋 **Overview**
Base URL: `http://localhost:5050/api/v1`

**Authentication**: JWT Bearer Token required for most endpoints  
**Content-Type**: `application/json`

---

## 🔐 **Authentication**

### **Verify Token**
```http
POST /api/v1/auth/verify
```

**Request Body:**
```json
{
  "token": "your_jwt_token_here"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "WAITER",
      "tenantId": "tenant_id",
      "tenant": {
        "id": "tenant_id",
        "name": "Restaurant Name",
        "slug": "restaurant-slug",
        "logo": "logo_url",
        "colors": {},
        "isActive": true
      }
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## 🍽️ **Menu Management**

### **Get All Menu Items**
```http
GET /api/v1/menu/items?category=category_id
```

**Query Parameters:**
- `category` (optional): Filter by category ID

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "item_id",
        "name": "Burger",
        "description": "Delicious burger",
        "price": 12.99,
        "category": "Main Course",
        "categoryId": "category_id",
        "image": "image_url",
        "isActive": true,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### **Create Menu Item**
```http
POST /api/v1/menu/items
```

**Request Body:**
```json
{
  "name": "New Item",
  "description": "Item description",
  "price": 15.99,
  "categoryId": "category_id",
  "image": "image_url"
}
```

### **Update Menu Item**
```http
PUT /api/v1/menu/items/:id
```

**Request Body:**
```json
{
  "name": "Updated Item",
  "description": "Updated description",
  "price": 16.99,
  "categoryId": "category_id",
  "image": "new_image_url",
  "isActive": true
}
```

### **Delete Menu Item**
```http
DELETE /api/v1/menu/items/:id
```

---

## 📂 **Categories**

### **Get All Categories**
```http
GET /api/v1/menu/categories
```

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "category_id",
        "name": "Main Course",
        "sortOrder": 1,
        "isActive": true,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### **Create Category**
```http
POST /api/v1/menu/categories
```

**Request Body:**
```json
{
  "name": "New Category",
  "sortOrder": 2
}
```

### **Update Category**
```http
PUT /api/v1/menu/categories/:id
```

**Request Body:**
```json
{
  "name": "Updated Category",
  "sortOrder": 1,
  "isActive": true
}
```

### **Delete Category**
```http
DELETE /api/v1/menu/categories/:id
```

---

## 🪑 **Tables Management**

### **Get All Tables**
```http
GET /api/v1/tables
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tables": [
      {
        "id": "table_id",
        "number": "1",
        "capacity": 4,
        "status": "available",
        "location": "Window",
        "currentOrderId": null,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### **Create Table**
```http
POST /api/v1/tables
```

**Request Body:**
```json
{
  "number": "5",
  "capacity": 6,
  "location": "Garden",
  "status": "available"
}
```

### **Update Table**
```http
PUT /api/v1/tables/:id
```

**Request Body:**
```json
{
  "number": "5",
  "capacity": 8,
  "status": "occupied",
  "location": "Garden",
  "currentOrderId": "order_id"
}
```

### **Update Table Status**
```http
PUT /api/v1/tables/:id/status
```

**Request Body:**
```json
{
  "status": "occupied"
}
```

**Valid Status Values:**
- `available`
- `occupied`
- `reserved`
- `cleaning`

### **Delete Table**
```http
DELETE /api/v1/tables/:id
```

---

## 🛒 **Orders Management**

### **Get All Orders**
```http
GET /api/v1/orders?status=pending&tableId=1
```

**Query Parameters:**
- `status` (optional): Filter by order status
- `tableId` (optional): Filter by table number

**Response:**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "order_id",
        "tableId": "1",
        "tableNumber": "1",
        "items": [
          {
            "id": "item_id",
            "menuItemId": "menu_item_id",
            "menuItemName": "Burger",
            "quantity": 2,
            "price": 12.99,
            "notes": "Extra cheese",
            "status": "pending"
          }
        ],
        "total": 25.98,
        "status": "pending",
        "waiterId": "waiter_id",
        "waiterName": "John Doe",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### **Create Order**
```http
POST /api/v1/orders
```

**Request Body:**
```json
{
  "tableId": "1",
  "items": [
    {
      "menuItemId": "menu_item_id",
      "quantity": 2,
      "notes": "Extra cheese"
    }
  ]
}
```

### **Update Order Status**
```http
PUT /api/v1/orders/:id
```

**Request Body:**
```json
{
  "status": "preparing"
}
```

**Valid Status Values:**
- `pending`
- `preparing`
- `ready`
- `served`
- `cancelled`

### **Update Order Item Status**
```http
PUT /api/v1/orders/:id/items/:itemId
```

**Request Body:**
```json
{
  "status": "ready"
}
```

**Valid Status Values:**
- `pending`
- `preparing`
- `ready`
- `served`

### **Cancel Order**
```http
DELETE /api/v1/orders/:id
```

---

## 📊 **Analytics**

### **Get Sales Analytics**
```http
GET /api/v1/analytics/sales?startDate=2024-01-01&endDate=2024-01-31
```

**Query Parameters:**
- `startDate` (optional): Start date (ISO format)
- `endDate` (optional): End date (ISO format)

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSales": 1250.50,
    "totalOrders": 45,
    "averageOrderValue": 27.79,
    "topItems": [
      {
        "menuItemId": "item_id",
        "name": "Burger",
        "quantity": 25,
        "revenue": 324.75
      }
    ],
    "dailySales": [
      {
        "date": "2024-01-01",
        "sales": 150.25,
        "orders": 5
      }
    ]
  }
}
```

### **Get Order Analytics**
```http
GET /api/v1/analytics/orders?status=pending&tableId=1
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pendingOrders": 5,
    "preparingOrders": 3,
    "readyOrders": 2,
    "completedOrders": 15
  }
}
```

---

## ⚙️ **Settings**

### **Get Restaurant Settings**
```http
GET /api/v1/settings
```

### **Update Restaurant Settings**
```http
PUT /api/v1/settings
```

---

## 🔧 **Health Check**

### **Service Health**
```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "OK",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "uptime": 3600,
    "environment": "development",
    "version": "1.0.0"
  },
  "message": "Service is healthy"
}
```

---

## 🚨 **Error Responses**

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Common Error Codes:**
- `VALIDATION_ERROR`: Invalid request data
- `FETCH_ERROR`: Failed to fetch data
- `CREATE_ERROR`: Failed to create resource
- `UPDATE_ERROR`: Failed to update resource
- `DELETE_ERROR`: Failed to delete resource
- `NOT_FOUND`: Resource not found
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `RATE_LIMIT_EXCEEDED`: Too many requests

---

## 🔑 **Authentication & Authorization**

### **Required Headers**
```http
Authorization: Bearer your_jwt_token_here
Content-Type: application/json
```

### **User Roles**
- `TENANT_ADMIN`: Full access
- `MANAGER`: Management operations
- `WAITER`: Order management
- `CASHIER`: Payment operations
- `KITCHEN`: Kitchen operations

---

## 📝 **Implementation Notes**

### **Frontend Integration**
1. **Token Management**: Store JWT token in localStorage/sessionStorage
2. **Error Handling**: Implement global error handler for API responses
3. **Loading States**: Show loading indicators during API calls
4. **Real-time Updates**: Consider WebSocket for order status updates
5. **Offline Support**: Cache menu items and categories locally

### **Best Practices**
- Always check `success` field in responses
- Handle network errors gracefully
- Implement retry logic for failed requests
- Use proper HTTP status codes
- Validate data before sending to API

### **Rate Limiting**
- 100 requests per 15 minutes per IP
- Implement exponential backoff for retries

---

## 🎯 **Quick Start for Frontend**

```javascript
// API Configuration
const API_BASE = 'http://localhost:5050/api/v1';
const TOKEN = localStorage.getItem('jwt_token');

// API Helper
const apiCall = async (endpoint, options = {}) => {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error.message);
  }
  
  return data.data;
};

// Example Usage
const getMenuItems = () => apiCall('/menu/items');
const createOrder = (orderData) => apiCall('/orders', {
  method: 'POST',
  body: JSON.stringify(orderData)
});
```

---

## 📞 **Support**

For API support or questions, refer to the backend logs or contact the development team.

**Server Info:**
- Health Check: `http://localhost:5050/health`
- Metrics: `http://localhost:5050/metrics`
- Environment: Development/Production 