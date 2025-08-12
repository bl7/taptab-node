#!/bin/bash

# Kitchen API Test Script
# Make sure your server is running and you have the database migration applied

BASE_URL="http://localhost:5050"
API_VERSION="v1"
TENANT_SLUG="test-restaurant"
AUTH_TOKEN="your-auth-token-here"  # Replace with actual token

echo "🚀 Testing Kitchen API Endpoints"
echo "📍 Base URL: $BASE_URL"
echo "🏪 Tenant: $TENANT_SLUG"
echo ""

# Test 1: Kitchen Dashboard
echo "🧪 Test 1: GET /api/$API_VERSION/kitchen/dashboard"
curl -s -X GET \
  "$BASE_URL/api/$API_VERSION/kitchen/dashboard" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Slug: $TENANT_SLUG" \
  | jq '.data.dashboard.statistics' 2>/dev/null || echo "Response received"
echo ""

# Test 2: Get Kitchen Orders
echo "🧪 Test 2: GET /api/$API_VERSION/kitchen/orders"
curl -s -X GET \
  "$BASE_URL/api/$API_VERSION/kitchen/orders" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Slug: $TENANT_SLUG" \
  | jq '.data.orders | length' 2>/dev/null || echo "Response received"
echo ""

# Test 3: Get Orders with Pending Status Filter
echo "🧪 Test 3: GET /api/$API_VERSION/kitchen/orders?status=pending"
curl -s -X GET \
  "$BASE_URL/api/$API_VERSION/kitchen/orders?status=pending" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Slug: $TENANT_SLUG" \
  | jq '.data.orders | length' 2>/dev/null || echo "Response received"
echo ""

# Test 4: Test Invalid Status (should return 400)
echo "🧪 Test 4: Testing invalid status validation"
curl -s -X PUT \
  "$BASE_URL/api/$API_VERSION/kitchen/orders/test-order/test-item/status" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Slug: $TENANT_SLUG" \
  -H "Content-Type: application/json" \
  -d '{"status": "invalid_status"}' \
  | jq '.error' 2>/dev/null || echo "Response received"
echo ""

echo "✅ Kitchen API tests completed!"
echo ""
echo "📝 To test with real data:"
echo "1. Create an order first using the public orders endpoint"
echo "2. Get the order ID from the response"
echo "3. Use that order ID to test the detailed order endpoint"
echo "4. Use the item IDs to test status updates"
