const { executeQuery } = require('./src/utils/database');

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    const result = await executeQuery('SELECT 1 as test');
    console.log('✅ Database connection successful:', result.rows[0]);
    
    // Test users table
    console.log('\n🔍 Testing users table...');
    const usersResult = await executeQuery('SELECT COUNT(*) as count FROM users');
    console.log('✅ Users table accessible:', usersResult.rows[0]);
    
    // Test a simple user query
    console.log('\n🔍 Testing user query...');
    const userQuery = await executeQuery('SELECT id, email FROM users LIMIT 1');
    console.log('✅ User query successful:', userQuery.rows.length, 'users found');
    
    if (userQuery.rows.length > 0) {
      console.log('📝 Sample user:', userQuery.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Full error:', error);
  }
}

testDatabaseConnection();
