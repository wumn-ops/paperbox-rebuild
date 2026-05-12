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

  return { db, dbPath }
}
