export const schema = `
CREATE TABLE IF NOT EXISTS papers (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  authors      TEXT,
  year         INTEGER,
  source_name  TEXT,
  abstract     TEXT,
  keywords     TEXT,
  doi          TEXT,
  ai_summary   TEXT,
  file_path    TEXT NOT NULL,
  file_type    TEXT NOT NULL,
  file_size    INTEGER,
  file_hash    TEXT,
  file_content TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#2563eb',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_folders (
  paper_id   TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (paper_id, folder_id)
);

CREATE TABLE IF NOT EXISTS paper_tags (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  paper_id   TEXT REFERENCES papers(id) ON DELETE SET NULL,
  parent_id  TEXT REFERENCES notes(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  is_group   INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  paper_ids  TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  api_key    TEXT NOT NULL DEFAULT '',
  base_url   TEXT NOT NULL,
  model      TEXT NOT NULL,
  provider   TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  authors,
  abstract,
  keywords,
  file_content
);

CREATE INDEX IF NOT EXISTS idx_papers_updated_at ON papers(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_file_hash ON papers(file_hash);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_paper_id ON notes(paper_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id, sort_order);
`
