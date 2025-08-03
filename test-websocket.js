const io = require('socket.io-client');

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:5050';
const JWT_TOKEN = process.env.JWT_TOKEN || 'your-jwt-token-here';

console.log('🧪 Testing WebSocket notifications...');
console.log(`📍 Connecting to: ${SOCKET_URL}`);

const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true
});

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  console.log('Socket ID:', socket.id);
  
  // Authenticate with JWT token
  socket.emit('authenticate', { token: JWT_TOKEN });
});

socket.on('authenticated', (data) => {
  console.log('✅ Authenticated successfully');
  console.log('Auth data:', data);
  
  // Listen for new order notifications
  socket.on('newOrder', (data) => {
    console.log('🎉 Received new order notification!');
    console.log('Notification data:', JSON.stringify(data, null, 2));
  });
  
  console.log('👂 Listening for new order notifications...');
  console.log('💡 Create a new order to test notifications');
});

socket.on('authentication_error', (error) => {
  console.error('❌ Authentication failed:', error);
});

socket.on('disconnect', () => {
  console.log('🔌 Disconnected from WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
});

// Keep the script running
console.log('Press Ctrl+C to exit');
process.on('SIGINT', () => {
  console.log('\n👋 Disconnecting...');
  socket.disconnect();
  process.exit(0);
}); 