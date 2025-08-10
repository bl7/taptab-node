# 🚀 Promotions Quick Reference Card

## 🔗 **Essential Endpoints**

| Route               | Method | Auth | Use Case                          |
| ------------------- | ------ | ---- | --------------------------------- |
| `/public/active`    | GET    | ❌   | Show promotions on customer pages |
| `/public/calculate` | POST   | ❌   | Calculate cart discounts          |
| `/`                 | GET    | ✅   | Staff: List all promotions        |
| `/`                 | POST   | ✅   | Staff: Create promotion           |
| `/active`           | GET    | ✅   | Staff: Get active promotions      |

## 📊 **Promotion Types**

| Type             | Description          | Key Fields                                                     |
| ---------------- | -------------------- | -------------------------------------------------------------- |
| `HAPPY_HOUR`     | Time-based discounts | `start_time`, `end_time`, `days_of_week`                       |
| `BOGO`           | Buy X Get Y Free     | `buy_quantity`, `get_quantity`, `buy_target_*`, `get_target_*` |
| `PERCENTAGE_OFF` | % discount           | `discount_value`, `max_discount_amount`                        |
| `FIXED_OFF`      | $ amount off         | `discount_value`, `min_order_amount`                           |

## 🎯 **Targeting Options**

| Target     | Description       | Fields                 |
| ---------- | ----------------- | ---------------------- |
| `ALL`      | Entire order      | None                   |
| `CATEGORY` | Specific category | `target_category_id`   |
| `PRODUCTS` | Specific products | `target_product_ids[]` |

## 💡 **Quick Examples**

### **Happy Hour Drinks**

```json
{
  "type": "HAPPY_HOUR",
  "discount_value": 15.0,
  "target_type": "CATEGORY",
  "target_category_id": "drinks_456",
  "start_time": "17:00",
  "end_time": "19:00"
}
```

### **Buy 2 Get 1 Free Pizza**

```json
{
  "type": "BOGO",
  "buy_quantity": 2,
  "get_quantity": 1,
  "buy_target_type": "CATEGORY",
  "buy_target_category_id": "pizza_789",
  "get_target_type": "CATEGORY",
  "get_target_category_id": "pizza_789"
}
```

### **10% off Specific Item**

```json
{
  "type": "PERCENTAGE_OFF",
  "discount_value": 10.0,
  "target_type": "PRODUCTS",
  "target_product_ids": ["chicken_curry_001"]
}
```

## 🔑 **Required Fields**

**All Promotions:**

- `name`, `type`, `tenantId`

**BOGO:**

- `buy_quantity`, `get_quantity`, `buy_target_type`, `get_target_type`

**Happy Hour:**

- `start_time`, `end_time`, `days_of_week`

## 📱 **QR Ordering Flow**

1. **Fetch Active Promotions**: `GET /public/active?tenantId=X`
2. **Calculate Cart**: `POST /public/calculate` with order items
3. **Display Results**: Show applied promotions and final total

## ⚠️ **Common Issues**

- **401 Error**: Invalid/missing JWT token
- **400 Error**: Missing required fields
- **Empty Response**: No promotions exist for tenant
- **No Discount**: Promotion conditions not met

## 🎯 **Testing Tips**

- Start with public routes (no auth needed)
- Use real tenant IDs from your database
- Test with various order combinations
- Verify time-based promotions work correctly

## GET Route: Fetch Promotions

**Route**: `GET /api/v1/simple-promotions`

**Authentication**: Required (JWT token)
**Required Role**: `WAITER`, `CASHIER`, `KITCHEN`, `MANAGER`, or `TENANT_ADMIN`

**Query Parameters**:

- `active` (optional): Filter by active status (`true`/`false`)
- `type` (optional): Filter by promotion type

**Data Returned**:

```json
{
  "success": true,
  "data": {
    "promotions": [
      {
        "id": "promo_1234567890_abc12",
        "name": "Promotion Name",
        "description": "Promotion description",
        "type": "PERCENTAGE_OFF|FIXED_OFF|BOGO|HAPPY_HOUR",
        "discount_value": 10,
        "min_order_amount": 0,
        "max_discount_amount": 50,
        "buy_quantity": 1,
        "get_quantity": 1,
        "start_time": "18:00",
        "end_time": "22:00",
        "days_of_week": [1, 2],
        "target_type": "ALL|CATEGORY|PRODUCTS",
        "target_category_id": "category_id",
        "target_product_ids": ["product1", "product2"],
        "priority": 1,
        "startDate": "2024-01-01",
        "endDate": "2024-12-31",
        "tenantId": "tenant_id",
        "isActive": true,
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z",
        "buy_target_type": "ALL|CATEGORY|PRODUCTS",
        "buy_target_category_id": "category_id",
        "buy_target_product_ids": ["product1", "product2"],
        "get_target_type": "ALL|CATEGORY|PRODUCTS",
        "get_target_category_id": "category_id",
        "get_target_product_ids": ["product1", "product2"]
      }
    ]
  }
}
```

**Notes**:

- Results are ordered by `priority DESC` then `createdAt DESC`
- Only returns promotions for the authenticated user's tenant
- The route is protected by JWT authentication and role-based access control
- You can filter results using the `active` and `type` query parameters
- `days_of_week` is returned as an array of integers (1=Monday, 7=Sunday)
- BOGO promotions include separate targeting for "buy" vs "get" items

## POST Route: Create Promotion

**Route**: `POST /api/v1/simple-promotions`

**Authentication**: Required (JWT token)
**Required Role**: `MANAGER` or `TENANT_ADMIN`

**Data to Send** (JSON body):

```json
{
  "name": "Promotion Name",
  "description": "Promotion description",
  "type": "PERCENTAGE_OFF|FIXED_OFF|BOGO|HAPPY_HOUR",
  "discount_value": 10,
  "min_order_amount": 0,
  "max_discount_amount": 50,
  "buy_quantity": 1,
  "get_quantity": 1,
  "start_time": "18:00",
  "end_time": "22:00",
  "days_of_week": ["monday", "tuesday"],
  "target_type": "ALL|CATEGORY|PRODUCTS",
  "target_category_id": "category_id",
  "target_product_ids": ["product1", "product2"],
  "priority": 1,
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "buy_target_type": "ALL|CATEGORY|PRODUCTS",
  "buy_target_category_id": "category_id",
  "buy_target_product_ids": ["product1", "product2"],
  "get_target_type": "ALL|CATEGORY|PRODUCTS",
  "get_target_category_id": "category_id",
  "get_target_product_ids": ["product1", "product2"]
}
```

**Required Fields**:

- `name`: Promotion name
- `type`: Promotion type

**Conditional Requirements**:

- If `type` is `"HAPPY_HOUR"`: `start_time` and `end_time` are required
- If `type` is `"BOGO"`: `buy_quantity` and `get_quantity` are required
- If `type` is NOT `"BOGO"`: `discount_value` is required

**BOGO-Specific Fields**:

- `buy_target_type`: What customers need to buy (ALL/CATEGORY/PRODUCTS)
- `buy_target_category_id`: Category ID for buy items (if buy_target_type is CATEGORY)
- `buy_target_product_ids`: Array of product IDs for buy items (if buy_target_type is PRODUCTS)
- `get_target_type`: What customers get for free (ALL/CATEGORY/PRODUCTS)
- `get_target_category_id`: Category ID for free items (if get_target_type is CATEGORY)
- `get_target_product_ids`: Array of product IDs for free items (if get_target_type is PRODUCTS)

**Response**:

```json
{
  "success": true,
  "data": {
    "promotion": {
      // Full promotion object with generated ID and timestamps
    }
  },
  "message": "Promotion created successfully"
}
```

**Notes**:

- The `id` is automatically generated in format: `promo_{timestamp}_{random}`
- `tenantId` is automatically set from the authenticated user's context
- `createdAt` and `updatedAt` are automatically set
- `days_of_week` accepts day names (monday, tuesday, etc.) or numbers (1-7)
- Only managers and tenant admins can create promotions

- `createdAt` and `updatedAt` are automatically set
- `days_of_week` accepts day names (monday, tuesday, etc.) or numbers (1-7)
- Only managers and tenant admins can create promotions
