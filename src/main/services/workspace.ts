import { randomUUID } from 'node:crypto'
import type { DatabaseContext } from './database'
import type { FolderItem, NoteItem, TagItem } from '../../shared/contracts'

interface FolderRow {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  created_at: number
  paper_count: number
}

interface TagRow {
  id: string
  name: string
  color: string
  created_at: number
  paper_count: number
}

interface NoteRow {
  id: string
  paper_id: string | null
  parent_id: string | null
  title: string
  content: string
  is_group: number
  sort_order: number
  created_at: number
  updated_at: number
}

export interface WorkspaceService {
  listFolders(): FolderItem[]
  createFolder(input: { name: string; parentId?: string | null }): FolderItem
  listTags(): TagItem[]
  createTag(input: { name: string; color?: string }): TagItem
  setPaperFolder(input: { paperId: string; folderId: string | null }): void
  setPaperTags(input: { paperId: string; tagIds: string[] }): void
  listNotes(paperId: string | null): NoteItem[]
  createNote(input: { paperId: string | null; parentId?: string | null; title: string; isGroup: boolean }): NoteItem
  updateNote(input: { id: string; title: string; content: string }): NoteItem | null
}

export function createWorkspaceService(database: DatabaseContext): WorkspaceService {
  const listFoldersStmt = database.db.prepare(`
    SELECT
      f.id,
      f.name,
      f.parent_id,
      f.sort_order,
      f.created_at,
      COUNT(pf.paper_id) AS paper_count
    FROM folders f
    LEFT JOIN paper_folders pf ON pf.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.sort_order ASC, f.created_at ASC
  `)

  const insertFolderStmt = database.db.prepare(`
    INSERT INTO folders (id, name, parent_id, sort_order, created_at)
    VALUES (@id, @name, @parent_id, @sort_order, @created_at)
  `)

  const getFolderStmt = database.db.prepare(`
    SELECT
      f.id,
      f.name,
      f.parent_id,
      f.sort_order,
      f.created_at,
      COUNT(pf.paper_id) AS paper_count
    FROM folders f
    LEFT JOIN paper_folders pf ON pf.folder_id = f.id
    WHERE f.id = ?
    GROUP BY f.id
  `)

  const listTagsStmt = database.db.prepare(`
    SELECT
      t.id,
      t.name,
      t.color,
      t.created_at,
      COUNT(pt.paper_id) AS paper_count
    FROM tags t
    LEFT JOIN paper_tags pt ON pt.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at ASC
  `)

  const insertTagStmt = database.db.prepare(`
    INSERT INTO tags (id, name, color, created_at)
    VALUES (@id, @name, @color, @created_at)
  `)

  const getTagStmt = database.db.prepare(`
    SELECT
      t.id,
      t.name,
      t.color,
      t.created_at,
      COUNT(pt.paper_id) AS paper_count
    FROM tags t
    LEFT JOIN paper_tags pt ON pt.tag_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `)

  const clearPaperFoldersStmt = database.db.prepare(`DELETE FROM paper_folders WHERE paper_id = ?`)
  const insertPaperFolderStmt = database.db.prepare(`
    INSERT INTO paper_folders (paper_id, folder_id, created_at)
    VALUES (?, ?, ?)
  `)

  const clearPaperTagsStmt = database.db.prepare(`DELETE FROM paper_tags WHERE paper_id = ?`)
  const insertPaperTagStmt = database.db.prepare(`
    INSERT INTO paper_tags (paper_id, tag_id)
    VALUES (?, ?)
  `)

  const listNotesStmt = database.db.prepare(`
    SELECT
      id,
      paper_id,
      parent_id,
      title,
      content,
      is_group,
      sort_order,
      created_at,
      updated_at
    FROM notes
    WHERE ((@paperId IS NULL AND paper_id IS NULL) OR paper_id = @paperId)
    ORDER BY sort_order ASC, updated_at DESC, created_at ASC
  `)

  const insertNoteStmt = database.db.prepare(`
    INSERT INTO notes (
      id,
      paper_id,
      parent_id,
      title,
      content,
      is_group,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @paper_id,
      @parent_id,
      @title,
      @content,
      @is_group,
      @sort_order,
      @created_at,
      @updated_at
    )
  `)

  const updateNoteStmt = database.db.prepare(`
    UPDATE notes
    SET title = @title,
        content = @content,
        updated_at = @updated_at
    WHERE id = @id
  `)

  const getNoteStmt = database.db.prepare(`
    SELECT
      id,
      paper_id,
      parent_id,
      title,
      content,
      is_group,
      sort_order,
      created_at,
      updated_at
    FROM notes
    WHERE id = ?
  `)

  return {
    listFolders() {
      return (listFoldersStmt.all() as FolderRow[]).map(mapFolder)
    },
    createFolder(input) {
      const now = Date.now()
      const id = randomUUID()
      insertFolderStmt.run({
        id,
        name: input.name,
        parent_id: input.parentId ?? null,
        sort_order: now,
        created_at: now
      })
      return mapFolder(getFolderStmt.get(id) as FolderRow)
    },
    listTags() {
      return (listTagsStmt.all() as TagRow[]).map(mapTag)
    },
    createTag(input) {
      const now = Date.now()
      const id = randomUUID()
      insertTagStmt.run({
        id,
        name: input.name,
        color: input.color || pickTagColor(),
        created_at: now
      })
      return mapTag(getTagStmt.get(id) as TagRow)
    },
    setPaperFolder(input) {
      clearPaperFoldersStmt.run(input.paperId)
      if (input.folderId) {
        insertPaperFolderStmt.run(input.paperId, input.folderId, Date.now())
      }
    },
    setPaperTags(input) {
      clearPaperTagsStmt.run(input.paperId)
      for (const tagId of input.tagIds) {
        insertPaperTagStmt.run(input.paperId, tagId)
      }
    },
    listNotes(paperId) {
      return (listNotesStmt.all({ paperId }) as NoteRow[]).map(mapNote)
    },
    createNote(input) {
      const now = Date.now()
      const id = randomUUID()
      insertNoteStmt.run({
        id,
        paper_id: input.paperId,
        parent_id: input.parentId ?? null,
        title: input.title,
        content: '',
        is_group: input.isGroup ? 1 : 0,
        sort_order: now,
        created_at: now,
        updated_at: now
      })
      return mapNote(getNoteStmt.get(id) as NoteRow)
    },
    updateNote(input) {
      updateNoteStmt.run({
        id: input.id,
        title: input.title,
        content: input.content,
        updated_at: Date.now()
      })
      const row = getNoteStmt.get(input.id) as NoteRow | undefined
      return row ? mapNote(row) : null
    }
  }
}

function mapFolder(row: FolderRow): FolderItem {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    paperCount: row.paper_count
  }
}

function mapTag(row: TagRow): TagItem {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    paperCount: row.paper_count
  }
}

function mapNote(row: NoteRow): NoteItem {
  return {
    id: row.id,
    paperId: row.paper_id,
    parentId: row.parent_id,
    title: row.title,
    content: row.content,
    isGroup: row.is_group === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function pickTagColor(): string {
  const colors = ['#2563eb', '#0891b2', '#059669', '#ca8a04', '#dc2626', '#9333ea']
  return colors[Math.floor(Math.random() * colors.length)] ?? '#2563eb'
}
