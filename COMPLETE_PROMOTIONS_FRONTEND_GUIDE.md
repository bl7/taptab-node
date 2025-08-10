# 🎯 Complete Promotions System - Frontend Integration Guide

## 📋 **Overview**

This guide covers the complete promotion system for your restaurant POS, including both authenticated routes for staff and public routes for customer-facing pages (QR ordering, public menus).

## 🚀 **Quick Start**

- **Base URL**: `http://localhost:5050/api/v1/simple-promotions`
- **Public Routes**: No authentication required (for customer pages)
- **Staff Routes**: JWT token required (for staff management)

---

## 🔐 **Authentication Routes**

### 1. **Get All Promotions (Staff Only)**

**GET** `/api/v1/simple-promotions`

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "promo_123",
      "name": "Happy Hour Drinks",
      "type": "HAPPY_HOUR",
      "discount_value": 15.0,
      "target_type": "CATEGORY",
      "target_category_id": "drinks_456",
      "start_time": "17:00",
      "end_time": "19:00",
      "days_of_week": [1, 2, 3, 4, 5],
      "isActive": true
    }
  ]
}
```

### 2. **Create New Promotion (Staff Only)**

**POST** `/api/v1/simple-promotions`

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Request Body:**

```json
{
  "name": "Buy 2 Get 1 Free Pizza",
  "type": "BOGO",
  "buy_quantity": 2,
  "get_quantity": 1,
  "buy_target_type": "CATEGORY",
  "buy_target_category_id": "pizza_789",
  "get_target_type": "CATEGORY",
  "get_target_category_id": "pizza_789",
  "tenantId": "tenant_123"
}
```

### 3. **Update Promotion (Staff Only)**

**PUT** `/api/v1/simple-promotions/:id`

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Request Body:** Same as create

### 4. **Delete Promotion (Staff Only)**

**DELETE** `/api/v1/simple-promotions/:id`

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

### 5. **Get Active Promotions (Staff Only)**

**GET** `/api/v1/simple-promotions/active`

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**

- `tenantId` (required): Your restaurant's tenant ID

---

## 🌐 **Public Routes (No Authentication Required)**

### 6. **Get Public Active Promotions**

**GET** `/api/v1/simple-promotions/public/active`

**Query Parameters:**

- `tenantId` (required): Your restaurant's tenant ID

**Use Case:** Customer-facing pages, public menus, landing pages

**Response:** Same as staff route but no authentication required

### 7. **Calculate Public Promotions**

**POST** `/api/v1/simple-promotions/public/calculate`

**Request Body:**

```json
{
  "orderItems": [
    {
      "menuItemId": "item_123",
      "name": "Margherita Pizza",
      "unitPrice": 15.99,
      "quantity": 2,
      "categoryId": "pizza_789"
    }
  ],
  "tenantId": "tenant_123",
  "orderTime": "2024-01-15T18:30:00Z"
}
```

**Use Case:** Public order preview, customer cart calculation before login

**Response:**

```json
{
  "success": true,
  "data": {
    "applicablePromotions": [
      {
        "id": "promo_123",
        "name": "Buy 2 Get 1 Free Pizza",
        "type": "BOGO",
        "discount_amount": 15.99,
        "applied_items": ["item_123"]
      }
    ],
    "total_discount": 15.99,
    "final_total": 15.99
  }
}
```

---

## 🎨 **Promotion Types & Data Structure**

### **1. Happy Hour Promotions**

```json
{
  "name": "Happy Hour Drinks",
  "type": "HAPPY_HOUR",
  "discount_value": 15.0,
  "target_type": "CATEGORY",
  "target_category_id": "drinks_456",
  "start_time": "17:00",
  "end_time": "19:00",
  "days_of_week": [1, 2, 3, 4, 5],
  "isActive": true
}
```

**Fields:**

- `start_time`: Start time (HH:MM format)
- `end_time`: End time (HH:MM format)
- `days_of_week`: Array of days [1=Monday, 7=Sunday]

### **2. BOGO Promotions (Buy X Get Y Free)**

```json
{
  "name": "Buy 2 Get 1 Free Pizza",
  "type": "BOGO",
  "buy_quantity": 2,
  "get_quantity": 1,
  "buy_target_type": "CATEGORY",
  "buy_target_category_id": "pizza_789",
  "get_target_type": "CATEGORY",
  "get_target_category_id": "pizza_789"
}
```

**BOGO-Specific Fields:**

- `buy_quantity`: How many items customer must buy
- `get_quantity`: How many items customer gets free
- `buy_target_type`: `ALL`, `CATEGORY`, or `PRODUCTS` for buy items
- `buy_target_category_id`: Category ID for buy items
- `buy_target_product_ids`: Array of product IDs for buy items
- `get_target_type`: `ALL`, `CATEGORY`, or `PRODUCTS` for free items
- `get_target_category_id`: Category ID for free items
- `get_target_product_ids`: Array of product IDs for free items

### **3. Percentage Off Promotions**

```json
{
  "name": "10% off Chicken Curry",
  "type": "PERCENTAGE_OFF",
  "discount_value": 10.0,
  "target_type": "PRODUCTS",
  "target_product_ids": ["chicken_curry_001"],
  "max_discount_amount": 5.0
}
```

**Fields:**

- `discount_value`: Percentage discount (e.g., 10.0 for 10%)
- `max_discount_amount`: Maximum discount amount (optional)

### **4. Fixed Amount Off Promotions**

```json
{
  "name": "$5 off orders over $25",
  "type": "FIXED_OFF",
  "discount_value": 5.0,
  "min_order_amount": 25.0,
  "target_type": "ALL"
}
```

**Fields:**

- `discount_value`: Fixed amount discount (e.g., 5.00 for $5 off)
- `min_order_amount`: Minimum order amount required

---

## 🎯 **Targeting Fields Explained**

### **target_type Values:**

- `ALL`: Applies to entire order
- `CATEGORY`: Applies to specific category
- `PRODUCTS`: Applies to specific products

### **When to Use Each:**

- **Happy Hour**: Use `target_type` + `target_category_id` or `target_product_ids`
- **BOGO**: Use `buy_target_*` for items customer buys, `get_target_*` for free items
- **Percentage/Fixed Off**: Use `target_type` + `target_category_id` or `target_product_ids`

---

## 🖥️ **Frontend Implementation Examples**

### **1. Staff Promotion Management Page**

```javascript
// Get all promotions
const response = await fetch("/api/v1/simple-promotions", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

// Create new promotion
const newPromo = await fetch("/api/v1/simple-promotions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(promotionData),
});
```

### **2. Public Menu Page (QR Ordering)**

```javascript
// Get active promotions for display
const promotions = await fetch(
  `/api/v1/simple-promotions/public/active?tenantId=${tenantId}`
);

// Calculate promotions for cart preview
const calculation = await fetch("/api/v1/simple-promotions/public/calculate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    orderItems: cartItems,
    tenantId: tenantId,
    orderTime: new Date().toISOString(),
  }),
});
```

### **3. Customer Cart with Promotions**

```javascript
// Real-time promotion calculation
const calculatePromotions = async (cartItems) => {
  const response = await fetch("/api/v1/simple-promotions/public/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderItems: cartItems,
      tenantId: tenantId,
      orderTime: new Date().toISOString(),
    }),
  });

  const result = await response.json();
  return result.data;
};
```

---

## 🔧 **Form Structure for Staff**

### **Basic Fields (All Promotions):**

- Name
- Description
- Type (dropdown: HAPPY_HOUR, BOGO, PERCENTAGE_OFF, FIXED_OFF)
- Discount Value
- Min Order Amount
- Max Discount Amount (for percentage)
- Start Date
- End Date
- Priority
- Is Active

### **Type-Specific Fields:**

#### **Happy Hour:**

- Start Time
- End Time
- Days of Week (checkboxes)
- Target Type (dropdown)
- Target Category/Products

#### **BOGO:**

- Buy Quantity
- Get Quantity
- Buy Target Type (dropdown)
- Buy Category/Products
- Get Target Type (dropdown)
- Get Category/Products

#### **Percentage/Fixed Off:**

- Target Type (dropdown)
- Target Category/Products

---

## 📱 **QR Ordering Integration**

### **1. Display Active Promotions**

- Fetch from `/public/active` endpoint
- Show promotion banners on menu page
- Highlight applicable items

### **2. Real-time Cart Calculation**

- Use `/public/calculate` endpoint
- Update totals as items are added/removed
- Show applied promotions in cart

### **3. Order Submission**

- Include promotion calculations in final order
- Store which promotions were applied

---

## 🚨 **Error Handling**

### **Common HTTP Status Codes:**

- `200`: Success
- `400`: Bad Request (missing fields, invalid data)
- `401`: Unauthorized (invalid/missing token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `500`: Internal Server Error

### **Error Response Format:**

```json
{
  "success": false,
  "error": "Validation failed",
  "details": ["Name is required", "Invalid promotion type"]
}
```

---

## 🧪 **Testing Your Integration**

### **1. Test Public Routes First**

- No authentication required
- Use any valid tenantId
- Test with sample order data

### **2. Test Staff Routes**

- Generate valid JWT token
- Test CRUD operations
- Verify permissions

### **3. Test Edge Cases**

- Empty orders
- Invalid product IDs
- Expired promotions
- Time-based promotions

---

## 📞 **Need Help?**

If you encounter issues:

1. Check the API response for error details
2. Verify your JWT token is valid
3. Ensure all required fields are provided
4. Check the server logs for backend errors

---

## 🎉 **You're Ready!**

Your frontend now has everything needed to:

- ✅ Display promotions on public pages
- ✅ Calculate real-time discounts
- ✅ Manage promotions for staff
- ✅ Handle all promotion types
- ✅ Integrate with QR ordering system

The backend is fully tested and ready to handle your promotion needs!
