const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkUsers() {
  try {
    console.log('🔍 Checking users in database...');
    
    // Get all users (without sensitive data)
    const result = await pool.query(`
      SELECT id, email, "firstName", "lastName", role, "tenantId", "isActive"
      FROM users 
      WHERE "isActive" = true
      ORDER BY email
    `);
    
    console.log(`\n👥 Found ${result.rows.length} active users:`);
    result.rows.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (${user.role}) - ${user.firstName} ${user.lastName}`);
    });
    
    if (result.rows.length > 0) {
      console.log('\n💡 To test the login route, update test-login.js with one of these emails');
      console.log('💡 You\'ll also need to know the PIN/password for that user');
    } else {
      console.log('\n❌ No active users found in database');
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

checkUsers();
