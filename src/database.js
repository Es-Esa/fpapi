import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../data/procurement.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize database schema
 */
export function initializeDatabase() {
  console.log('Initializing database schema...');

  // Procurement Invoices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS procurement_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lasku_id TEXT NOT NULL UNIQUE,
      hankintayksikko TEXT NOT NULL,
      hankintayksikko_tunnus TEXT,
      ylaorganisaatio TEXT,
      ylaorganisaatio_tunnus TEXT,
      toimittaja_y_tunnus TEXT,
      toimittaja_nimi TEXT,
      toimittaja_kunta TEXT,
      tili TEXT,
      hankintakategoria TEXT NOT NULL,
      tuote_palveluryhma TEXT,
      tositepvm TEXT NOT NULL,
      tiliointisumma REAL NOT NULL,
      sektori TEXT,
      data_year INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tositepvm ON procurement_invoices(tositepvm);
    CREATE INDEX IF NOT EXISTS idx_hankintakategoria ON procurement_invoices(hankintakategoria);
    CREATE INDEX IF NOT EXISTS idx_toimittaja_nimi ON procurement_invoices(toimittaja_nimi);
    CREATE INDEX IF NOT EXISTS idx_toimittaja_kunta ON procurement_invoices(toimittaja_kunta);
    CREATE INDEX IF NOT EXISTS idx_hankintayksikko ON procurement_invoices(hankintayksikko);
    CREATE INDEX IF NOT EXISTS idx_sektori ON procurement_invoices(sektori);
    CREATE INDEX IF NOT EXISTS idx_data_year ON procurement_invoices(data_year);
    CREATE INDEX IF NOT EXISTS idx_tiliointisumma ON procurement_invoices(tiliointisumma);
  `);

  // Dataset metadata table (track downloaded files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT NOT NULL UNIQUE,
      resource_name TEXT NOT NULL,
      resource_url TEXT NOT NULL,
      file_format TEXT,
      data_year INTEGER,
      last_modified TEXT,
      downloaded_at DATETIME,
      records_imported INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // System configuration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Database schema initialized successfully');
}

/**
 * Get database statistics
 */
export function getDatabaseStats() {
  const stats = {
    totalInvoices: db.prepare('SELECT COUNT(*) as count FROM procurement_invoices').get().count,
    yearBreakdown: db.prepare(`
      SELECT data_year, COUNT(*) as count, SUM(tiliointisumma) as total_value
      FROM procurement_invoices
      GROUP BY data_year
      ORDER BY data_year DESC
    `).all(),
    lastUpdate: db.prepare(`
      SELECT MAX(downloaded_at) as last_update
      FROM dataset_metadata
      WHERE status = 'completed'
    `).get().last_update,
    datasetFiles: db.prepare('SELECT COUNT(*) as count FROM dataset_metadata').get().count
  };

  return stats;
}

/**
 * Clear all invoice data (for re-import)
 */
export function clearInvoiceData() {
  console.log('Clearing all invoice data...');
  db.prepare('DELETE FROM procurement_invoices').run();
  db.prepare('DELETE FROM dataset_metadata').run();
  console.log('✅ All invoice data cleared');
}

export default db;
