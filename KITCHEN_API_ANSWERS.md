# Kitchen API - Backend Team Answers

## ✅ **All Your Questions Answered**

### 1. **Item Status Values**

**Valid Status Values:**

- `"pending"` - Item is not cooked yet (default)
- `"cooked"` - Item has been cooked and is ready
- `"ready"` - Same as "cooked" (frontend-friendly)
- `"active"` - Same as "pending" (legacy support)

**Status Mapping:**

- Frontend sends `"ready"` → Database stores `"cooked"`
- Frontend sends `"active"` → Database stores `"pending"`
- Frontend sends `"cooked"` → Database stores `"cooked"`
- Frontend sends `"pending"` → Database stores `"pending"`

### 2. **API Request Format**

**✅ Correct Request Body:**

```json
{
  "status": "ready",
  "notes": "Ready to serve!"
}
```

**✅ Also Valid:**

```json
{
  "status": "cooked",
  "notes": "Ready to serve!"
}
```

### 3. **Item ID Format**

**✅ Correct Item ID:** `"oi_1754930970832_ijvce"`

This is the **order item ID** (starts with `oi_`), which is correct for this endpoint.

**❌ Wrong:** Don't use `menuItemId` - use the order item ID instead.

### 4. **API Endpoint**

**✅ Correct Endpoint:**

```
PUT /api/v1/kitchen/orders/{orderId}/items/{itemId}/status
```

**Example:**

```
PUT /api/v1/kitchen/orders/order_1754930969482_s4lkj/items/oi_1754930970832_ijvce/status
```

### 5. **Error Details Fixed**

The "UPDATE_ERROR" was caused by:

- ❌ **Database constraint violation** - status field only allowed "pending" or "cooked"
- ❌ **Missing updatedAt field** - trying to update non-existent field

**✅ Fixed:**

- Added support for "ready" and "active" status values
- Added `updatedAt` field to database
- Better error messages with specific validation details

## 🔧 **What Was Fixed**

### **Database Migration Updated:**

```sql
-- Now supports more status values
ALTER TABLE "orderItems"
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'
CHECK (status IN ('pending', 'cooked', 'ready', 'active'));

-- Added updatedAt field
ALTER TABLE "orderItems"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### **API Route Updated:**

- ✅ Accepts `"ready"` status (maps to `"cooked"`)
- ✅ Accepts `"active"` status (maps to `"pending"`)
- ✅ Better error messages
- ✅ Proper database field handling

## 📋 **Complete Working Example**

### **Request:**

```javascript
const response = await fetch(
  `/api/v1/kitchen/orders/order_1754930969482_s4lkj/items/oi_1754930970832_ijvce/status`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Slug": tenantSlug,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "ready",
      notes: "Ready to serve!",
    }),
  }
);
```

### **Expected Response:**

```json
{
  "success": true,
  "message": "Item status updated successfully",
  "data": {
    "item": {
      "id": "oi_1754930970832_ijvce",
      "menuItemId": "menu_item_id",
      "menuItemName": "Chana Bhuna",
      "quantity": 1,
      "unitPrice": 12.99,
      "totalPrice": 12.99,
      "notes": "Ready to serve!",
      "status": "cooked",
      "updatedAt": "2024-01-01T12:00:00Z"
    },
    "message": "Item status updated to cooked"
  }
}
```

## 🚀 **Next Steps**

1. **Apply the database migration:**

```bash
psql your_database_url -f add_order_items_status.sql
```

2. **Restart your backend server**

3. **Test with your frontend:**
   - Use `"ready"` as the status value
   - Use the order item ID (`oi_...`)
   - Include proper authentication headers

## 🎯 **Summary**

- ✅ **Status**: Use `"ready"` (maps to `"cooked"` in database)
- ✅ **Item ID**: Use order item ID (`oi_...`)
- ✅ **Endpoint**: `/api/v1/kitchen/orders/{orderId}/items/{itemId}/status`
- ✅ **Request Format**: `{"status": "ready", "notes": "..."}`
- ✅ **Error**: Fixed database constraints and missing fields

Your frontend should now work correctly! 🍕✅
