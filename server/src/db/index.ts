// ============================================================
// Database Connection
// Creates and exports the SQLite database instance.
// The DB file lives at server/data/dialler.db
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeDatabase } from './schema.js';

// Ensure the data directory exists
// In production, use DATA_DIR env var (for Railway volume mount), else default to server/data/
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'dialler.db');

// Create the database connection
const db = new Database(dbPath);

// Initialize schema (creates tables if they don't exist)
initializeDatabase(db);

/**
 * Returns the database instance.
 * Use this everywhere instead of importing `db` directly
 * so we have a single place to manage the connection.
 */
export function getDb(): Database.Database {
  return db;
}

export default db;
