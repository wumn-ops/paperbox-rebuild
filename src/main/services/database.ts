import Database from 'better-sqlite3'
import { schema } from '../db/schema'

export interface DatabaseContext {
  db: Database.Database
  dbPath: string
}

export function createDatabase(dbPath: string): DatabaseContext {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schema)

  const cols = db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'note_ids')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN note_ids TEXT NOT NULL DEFAULT '[]'`)
  }

  return { db, dbPath }
}
