// Simple WebSocket test client
const { io } = require('socket.io-client');

console.log('🔌 Testing WebSocket connection...');

// Connect to WebSocket server
const socket = io('http://localhost:5050', {
  transports: ['websocket', 'polling']
});

// Test JWT token (you'll need to replace this with a valid token)
const testJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjJmNzIxN2E5LWI0NjEtNDI5Mi1iODIxLWE0MjczOTVlY2VmZiIsImVtYWlsIjoibWFkcmlkaXN0YWJpc3dhc2hAZ21haWwuY29tIiwicm9sZSI6IlRFTkFOVF9BRE1JTiIsInRlbmFudElkIjoiNmU4YmE3MjAtZjdmNS00MzUyLTkxZDktMzY1NjMyY2ZhZjYwIiwiaWF0IjoxNzU0MTM0Mjk2LCJleHAiOjE3NTQxMzc4OTZ9.0dSOotQaetqfg99ytlFtJ1pAgc-ctq6LiWOchHci4uw';

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  
  // Authenticate with JWT token
  socket.emit('authenticate', { token: testJWT });
});

socket.on('authenticated', (data) => {
  console.log('✅ WebSocket authenticated successfully');
  console.log('👤 Role: TENANT_ADMIN (should receive print notifications)');
});

socket.on('authentication_error', (error) => {
  console.error('❌ WebSocket authentication failed:', error);
});

// Listen for new order notifications
socket.on('newOrder', (data) => {
  console.log('🖨️ NEW ORDER RECEIVED FOR PRINTING!');
  console.log('📋 Order Details:', JSON.stringify(data, null, 2));
  
  if (data.type === 'PRINT_RECEIPT') {
    console.log('🖨️ This is a print receipt notification');
    console.log(`📦 Order Number: ${data.order.orderNumber}`);
    console.log(`🪑 Table: ${data.order.tableNumber}`);
    console.log(`👤 Customer: ${data.order.customerName}`);
    console.log(`💰 Total: $${data.order.finalAmount}`);
    console.log(`📝 Items: ${data.order.items.length} items`);
    
    data.order.items.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.menuItemName} x${item.quantity} - $${item.total}`);
      if (item.notes) {
        console.log(`      Notes: ${item.notes}`);
      }
    });
  }
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('❌ WebSocket connection error:', error);
});

console.log('⏳ Waiting for WebSocket events...');
console.log('💡 Now place an order via QR code to test the notification!');
console.log('💡 Or use: curl -X POST "http://localhost:5050/api/v1/public/orders?tenant=tiffin" -H "Content-Type: application/json" -d \'{"tableNumber": 10, "items": [{"menuItemId": "item_1754121213685_fhtow", "quantity": 1, "notes": "Test notification"}], "customerName": "Test Customer", "customerPhone": "1234567890"}\'');

// Keep the script running
process.on('SIGINT', () => {
  console.log('\n👋 Disconnecting...');
  socket.disconnect();
  process.exit(0);
}); 