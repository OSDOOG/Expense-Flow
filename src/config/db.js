const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('neon') || process.env.DATABASE_URL.includes('supabase')
        ? { rejectUnauthorized: false }
        : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'expense_db',
    };

const pool = new Pool({
  ...dbConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
