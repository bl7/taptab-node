const axios = require('axios');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:5050';
const API_VERSION = 'v1';
const TENANT_SLUG = process.env.TENANT_SLUG || 'test-restaurant';

// Test data
let testOrderId = null;
let testItemId = null;
let authToken = null;

// Helper function to get auth token
async function getAuthToken() {
  try {
    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/auth/login`, {
      email: 'kitchen@test.com',
      password: 'password123'
    });
    return response.data.data.token;
  } catch (error) {
    console.log('⚠️  Using test token - make sure you have a kitchen user account');
    return 'test-token';
  }
}

// Helper function to create test order
async function createTestOrder() {
  try {
    const response = await axios.post(`${BASE_URL}/api/${API_VERSION}/public/orders`, {
      tableNumber: 'T1',
      customerName: 'Test Customer',
      customerPhone: '+1234567890',
      items: [
        {
          menuItemId: 'test-menu-item-1',
          quantity: 2,
          notes: 'Extra cheese'
        },
        {
          menuItemId: 'test-menu-item-2',
          quantity: 1,
          notes: 'No onions'
        }
      ]
    }, {
      headers: {
        'X-Tenant-Slug': TENANT_SLUG
      }
    });
    
    return response.data.data.order;
  } catch (error) {
    console.log('⚠️  Could not create test order, using mock data');
    return {
      id: 'test-order-id',
      orderNumber: 'ORD-TEST-001',
      items: [
        { id: 'test-item-1', menuItemId: 'test-menu-item-1' },
        { id: 'test-item-2', menuItemId: 'test-menu-item-2' }
      ]
    };
  }
}

// Test 1: Get Kitchen Dashboard
async function testKitchenDashboard() {
  console.log('\n🧪 Testing: GET /api/v1/kitchen/dashboard');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/${API_VERSION}/kitchen/dashboard`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Tenant-Slug': TENANT_SLUG
      }
    });
    
    console.log('✅ Dashboard retrieved successfully');
    console.log('📊 Statistics:', response.data.data.dashboard.statistics);
    console.log('📋 Recent Orders:', response.data.data.dashboard.recentOrders.length);
    
    return true;
  } catch (error) {
    console.log('❌ Dashboard test failed:', error.response?.data || error.message);
    return false;
  }
}

// Test 2: Get Kitchen Orders
async function testGetKitchenOrders() {
  console.log('\n🧪 Testing: GET /api/v1/kitchen/orders');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/${API_VERSION}/kitchen/orders`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Tenant-Slug': TENANT_SLUG
      }
    });
    
    console.log('✅ Kitchen orders retrieved successfully');
    console.log('📋 Orders found:', response.data.data.orders.length);
    
    if (response.data.data.orders.length > 0) {
      const firstOrder = response.data.data.orders[0];
      testOrderId = firstOrder.id;
      console.log('📝 First order:', {
        orderNumber: firstOrder.orderNumber,
        tableNumber: firstOrder.tableNumber,
        itemCounts: firstOrder.itemCounts
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ Get kitchen orders test failed:', error.response?.data || error.message);
    return false;
  }
}

// Test 3: Get Detailed Order
async function testGetDetailedOrder() {
  if (!testOrderId) {
    console.log('⚠️  Skipping detailed order test - no order ID available');
    return false;
  }
  
  console.log('\n🧪 Testing: GET /api/v1/kitchen/orders/:orderId');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/${API_VERSION}/kitchen/orders/${testOrderId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Tenant-Slug': TENANT_SLUG
      }
    });
    
    console.log('✅ Detailed order retrieved successfully');
    console.log('📋 Order items:', response.data.data.order.items.length);
    
    if (response.data.data.order.items.length > 0) {
      testItemId = response.data.data.order.items[0].id;
      console.log('🍕 First item:', {
        menuItemName: response.data.data.order.items[0].menuItemName,
        status: response.data.data.order.items[0].status
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ Get detailed order test failed:', error.response?.data || error.message);
    return false;
  }
}

// Test 4: Update Item Status
async function testUpdateItemStatus() {
  if (!testOrderId || !testItemId) {
    console.log('⚠️  Skipping status update test - no order/item ID available');
    return false;
  }
  
  console.log('\n🧪 Testing: PUT /api/v1/kitchen/orders/:orderId/items/:itemId/status');
  
  try {
    const response = await axios.put(
      `${BASE_URL}/api/${API_VERSION}/kitchen/orders/${testOrderId}/items/${testItemId}/status`,
      {
        status: 'cooked',
        notes: 'Test kitchen update - item is ready!'
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Tenant-Slug': TENANT_SLUG,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Item status updated successfully');
    console.log('🍕 Updated item:', {
      menuItemName: response.data.data.item.menuItemName,
      status: response.data.data.item.status,
      notes: response.data.data.item.notes
    });
    
    return true;
  } catch (error) {
    console.log('❌ Update item status test failed:', error.response?.data || error.message);
    return false;
  }
}

// Test 5: Test Invalid Status
async function testInvalidStatus() {
  if (!testOrderId || !testItemId) {
    console.log('⚠️  Skipping invalid status test - no order/item ID available');
    return false;
  }
  
  console.log('\n🧪 Testing: Invalid status validation');
  
  try {
    await axios.put(
      `${BASE_URL}/api/${API_VERSION}/kitchen/orders/${testOrderId}/items/${testItemId}/status`,
      {
        status: 'invalid_status'
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Tenant-Slug': TENANT_SLUG,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('❌ Invalid status test failed - should have rejected invalid status');
    return false;
  } catch (error) {
    if (error.response?.status === 400) {
      console.log('✅ Invalid status correctly rejected');
      return true;
    } else {
      console.log('❌ Unexpected error for invalid status:', error.response?.data || error.message);
      return false;
    }
  }
}

// Test 6: Test Status Filter
async function testStatusFilter() {
  console.log('\n🧪 Testing: GET /api/v1/kitchen/orders?status=pending');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/${API_VERSION}/kitchen/orders?status=pending`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Tenant-Slug': TENANT_SLUG
      }
    });
    
    console.log('✅ Status filter test successful');
    console.log('📋 Pending orders found:', response.data.data.orders.length);
    
    return true;
  } catch (error) {
    console.log('❌ Status filter test failed:', error.response?.data || error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Kitchen API Tests');
  console.log('📍 Base URL:', BASE_URL);
  console.log('🏪 Tenant:', TENANT_SLUG);
  
  // Get auth token
  authToken = await getAuthToken();
  console.log('🔑 Auth token obtained');
  
  // Create test order if needed
  const testOrder = await createTestOrder();
  testOrderId = testOrder.id;
  console.log('📝 Test order ID:', testOrderId);
  
  // Run all tests
  const tests = [
    testKitchenDashboard,
    testGetKitchenOrders,
    testGetDetailedOrder,
    testUpdateItemStatus,
    testInvalidStatus,
    testStatusFilter
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  for (const test of tests) {
    const result = await test();
    if (result) passedTests++;
  }
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('✅ Passed:', passedTests);
  console.log('❌ Failed:', totalTests - passedTests);
  console.log('📈 Success Rate:', Math.round((passedTests / totalTests) * 100) + '%');
  
  if (passedTests === totalTests) {
    console.log('\n🎉 All kitchen routes are working correctly!');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
