const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDatabaseStructure() {
  try {
    console.log('🔍 Checking database structure...');
    
    // Check if users table exists and get its structure
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `);
    
    console.log('📋 Users table structure:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Check if pin column exists
    const pinColumn = result.rows.find(row => row.column_name === 'pin');
    if (pinColumn) {
      console.log('\n✅ PIN column exists in users table');
    } else {
      console.log('\n❌ PIN column does not exist in users table');
      console.log('💡 You may need to add the PIN column to your users table');
    }
    
    // Check if there are any users in the table
    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log(`\n👥 Total users in database: ${userCount.rows[0].count}`);
    
    // Show a sample user (without sensitive data)
    if (userCount.rows[0].count > 0) {
      const sampleUser = await pool.query(`
        SELECT id, email, "firstName", "lastName", role, "tenantId", "isActive"
        FROM users 
        LIMIT 1
      `);
      console.log('\n📝 Sample user:');
      console.log(JSON.stringify(sampleUser.rows[0], null, 2));
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabaseStructure();
