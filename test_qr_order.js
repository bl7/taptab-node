const axios = require('axios');

async function testQROrder() {
  try {
    console.log('Testing QR order creation...');
    
    const response = await axios.post('http://localhost:5050/api/v1/public/orders', {
      tableId: 'test-table-id',
      items: [
        {
          menuItemId: 'test-item-1',
          quantity: 2,
          notes: 'Test QR order'
        }
      ],
      customerName: 'Test Customer'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': 'test-restaurant'
      }
    });

    console.log('Response:', response.data);
    console.log('Order status:', response.data.data.order.status);
    console.log('Payment status:', response.data.data.order.paymentStatus);
    console.log('Payment method:', response.data.data.order.paymentMethod);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testQROrder(); 