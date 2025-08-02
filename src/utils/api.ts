import { Pool } from "pg"

const pool = new Pool({
  host: process.env['DB_HOST'],
  port: parseInt(process.env['DB_PORT'] || '5432', 10),
  user: process.env['DB_USER'],
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_NAME'],
  ssl: {
    rejectUnauthorized: false, // required for Aiven
  },
  // Performance optimizations
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
  maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
})

// Test query to confirm connection
pool.query('SELECT current_database()', (err, res) => {
  if (err) {
    console.error('❌ DB Test Failed:', err)
  } else {
    console.log('✅ Connected to DB:', res.rows[0].current_database)
  }
})

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

export default pool 