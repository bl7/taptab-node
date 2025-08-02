const jwt = require('jsonwebtoken');

// Create a test token matching your actual JWT structure
const payload = {
  id: 'user-123',
  email: 'john.doe@example.com',
  role: 'user',
  tenantId: 'tenant-456',
  iss: 'taptab-auth-service'
};

const token = jwt.sign(payload, 'zentralify', { expiresIn: '24h' });

console.log('Generated JWT Token:');
console.log(token);
console.log('\nUse this token in your Authorization header:');
console.log(`Authorization: Bearer ${token}`); 