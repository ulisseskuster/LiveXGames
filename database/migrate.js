const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stream_gamification';

async function migrate() {
  console.log(
    `[Migrate] Conectando ao PostgreSQL em: ${connectionString.replace(/:[^:@]+@/, ':****@')}`
  );
  const pool = new Pool({ connectionString });

  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf-8');

    console.log('[Migrate] Executando schema.sql...');
    await pool.query(schemaSql);
    console.log('[Migrate] Schema criado com sucesso.');

    console.log('[Migrate] Executando seed.sql...');
    await pool.query(seedSql);
    console.log('[Migrate] Seed inicial inserido com sucesso.');

    console.log('[Migrate] Migração concluída com sucesso!');
  } catch (error) {
    console.error('[Migrate] Erro durante a migração:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
