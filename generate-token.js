const jwt = require('jsonwebtoken');

// Create a test token matching your actual JWT structure
const payload = {
  id: '2f7217a9-b461-4292-b821-a427395eceff',
  email: 'madridistabiswash@gmail.com',
  role: 'TENANT_ADMIN',
  tenantId: '6e8ba720-f7f5-4352-91d9-365632cfaf60'
};

const token = jwt.sign(payload, 'your-super-secret-jwt-key-change-this-in-production', { expiresIn: '24h' });

console.log('Generated JWT Token:');
console.log(token);
console.log('\nUse this token in your Authorization header:');
console.log(`Authorization: Bearer ${token}`); 