const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'your-tenant-id'; // Replace with actual tenant ID
const TABLE_NUMBER = '10';

async function testPaymentFlow() {
  console.log('🧪 Testing new payment flow...\n');

  try {
    // Step 1: Create a pending order
    console.log('1️⃣ Creating pending order...');
    const orderResponse = await axios.post(`${BASE_URL}/api/v1/public/orders`, {
      tableNumber: TABLE_NUMBER,
      items: [
        {
          menuItemId: 'item_1754121213685_fhtow', // Replace with actual menu item ID
          quantity: 1,
          notes: 'Test payment flow'
        }
      ],
      customerName: 'Test Customer',
      customerPhone: '5555555555'
    }, {
      headers: {
        'X-Tenant-Slug': 'your-restaurant-slug' // Replace with actual slug
      }
    });

    const order = orderResponse.data.data.order;
    console.log(`✅ Order created with status: ${order.status}`);
    console.log(`📋 Order ID: ${order.id}`);
    console.log(`💰 Amount: $${order.finalAmount}\n`);

    // Step 2: Create payment intent
    console.log('2️⃣ Creating payment intent...');
    const paymentIntentResponse = await axios.post(`${BASE_URL}/api/v1/stripe/orders/create-payment-intent`, {
      tenantId: TENANT_ID,
      amount: Math.round(order.finalAmount * 100), // Convert to cents
      currency: 'usd',
      orderId: order.id,
      customerEmail: 'test@example.com'
    });

    const paymentIntent = paymentIntentResponse.data.data;
    console.log(`✅ Payment intent created: ${paymentIntent.id}\n`);

    // Step 3: Simulate payment confirmation
    console.log('3️⃣ Confirming payment...');
    const confirmResponse = await axios.post(`${BASE_URL}/api/v1/stripe/orders/${order.id}/confirm-payment`, {
      tenantId: TENANT_ID,
      paymentIntentId: paymentIntent.id,
      paymentMethod: 'card',
      amount: Math.round(order.finalAmount * 100)
    });

    console.log(`✅ Payment confirmed: ${confirmResponse.data.data.paymentStatus}\n`);

    // Step 4: Check order status
    console.log('4️⃣ Checking final order status...');
    const statusResponse = await axios.get(`${BASE_URL}/api/v1/public/orders/${order.id}`, {
      headers: {
        'X-Tenant-Slug': 'your-restaurant-slug'
      }
    });

    const finalOrder = statusResponse.data.data.order;
    console.log(`✅ Final order status: ${finalOrder.status}`);
    console.log(`📊 Payment status: ${finalOrder.paymentStatus || 'N/A'}`);

    if (finalOrder.status === 'ACTIVE') {
      console.log('🎉 SUCCESS: Order was properly activated after payment!');
    } else {
      console.log('❌ FAILURE: Order status not updated correctly');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Test cleanup functionality
async function testCleanup() {
  console.log('\n🧹 Testing cleanup functionality...\n');

  try {
    // Get pending orders count
    const countResponse = await axios.get(`${BASE_URL}/api/v1/admin/cleanup/pending-orders`, {
      headers: {
        'Authorization': 'Bearer your-jwt-token' // Replace with actual JWT token
      }
    });

    console.log(`📊 Pending orders count: ${countResponse.data.data.pendingOrdersCount}`);

    // Get abandoned orders
    const abandonedResponse = await axios.get(`${BASE_URL}/api/v1/admin/cleanup/abandoned-orders?maxAgeMinutes=30`, {
      headers: {
        'Authorization': 'Bearer your-jwt-token'
      }
    });

    console.log(`📋 Abandoned orders: ${abandonedResponse.data.data.count}`);

  } catch (error) {
    console.error('❌ Cleanup test failed:', error.response?.data || error.message);
  }
}

// Run tests
if (require.main === module) {
  testPaymentFlow().then(() => {
    testCleanup();
  });
}

module.exports = { testPaymentFlow, testCleanup }; 