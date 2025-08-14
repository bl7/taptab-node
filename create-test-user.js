const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createTestUser() {
  try {
    console.log('🔧 Creating test user...');
    
    // Hash the PIN
    const hashedPin = await bcrypt.hash('123456', 10);
    
    // Check if test user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      ['test@example.com']
    );
    
    if (existingUser.rows.length > 0) {
      console.log('✅ Test user already exists');
      
      // Update the password
      await pool.query(
        'UPDATE users SET password = $1 WHERE email = $2',
        [hashedPin, 'test@example.com']
      );
      console.log('✅ Updated test user password');
    } else {
      // Create a new test user
      const result = await pool.query(`
        INSERT INTO users (id, email, password, "firstName", "lastName", role, "tenantId", "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, email, "firstName", "lastName", role
      `, [
        'test-user-' + Date.now(),
        'test@example.com',
        hashedPin,
        'Test',
        'User',
        'WAITER',
        'test-tenant-id', // You'll need to replace this with a real tenant ID
        true,
        new Date(),
        new Date()
      ]);
      
      console.log('✅ Created test user:', result.rows[0]);
    }
    
    console.log('\n📋 Test user credentials:');
    console.log('Email: test@example.com');
    console.log('PIN: 123456');
    
  } catch (error) {
    console.error('❌ Error creating test user:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

createTestUser();
