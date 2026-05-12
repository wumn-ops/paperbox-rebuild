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
  renameFolder(input: { folderId: string; name: string }): FolderItem | null
  deleteFolder(folderId: string): boolean
  listTags(): TagItem[]
  createTag(input: { name: string; color?: string }): TagItem
  renameTag(input: { tagId: string; name: string }): TagItem | null
  deleteTag(tagId: string): boolean
  setPaperFolder(input: { paperId: string; folderId: string | null }): void
  setPaperTags(input: { paperId: string; tagIds: string[] }): void
  listNotes(paperId: string | null): NoteItem[]
  createNote(input: { paperId: string | null; parentId?: string | null; title: string; isGroup: boolean }): NoteItem
  updateNote(input: { id: string; title: string; content: string }): NoteItem | null
  deleteNote(noteId: string): string[]
  setNoteParent(input: { noteId: string; parentId: string | null }): NoteItem | null
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

  const renameFolderStmt = database.db.prepare(`UPDATE folders SET name = @name WHERE id = @id`)
  const deleteFolderStmt = database.db.prepare(`DELETE FROM folders WHERE id = ?`)
  const renameTagStmt = database.db.prepare(`UPDATE tags SET name = @name WHERE id = @id`)
  const deleteTagStmt = database.db.prepare(`DELETE FROM tags WHERE id = ?`)

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

  const deleteNoteByIdStmt = database.db.prepare(`DELETE FROM notes WHERE id = ?`)

  const updateNoteParentStmt = database.db.prepare(`
    UPDATE notes
    SET parent_id = @parent_id,
        updated_at = @updated_at
    WHERE id = @id
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
    renameFolder(input) {
      renameFolderStmt.run({ name: input.name, id: input.folderId })
      const row = getFolderStmt.get(input.folderId) as FolderRow | undefined
      return row ? mapFolder(row) : null
    },
    deleteFolder(folderId) {
      const result = deleteFolderStmt.run(folderId)
      return result.changes > 0
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
    renameTag(input) {
      renameTagStmt.run({ name: input.name, id: input.tagId })
      const row = getTagStmt.get(input.tagId) as TagRow | undefined
      return row ? mapTag(row) : null
    },
    deleteTag(tagId) {
      const result = deleteTagStmt.run(tagId)
      return result.changes > 0
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
    },
    deleteNote(noteId) {
      const root = getNoteStmt.get(noteId) as NoteRow | undefined
      if (!root) return []

      const paperScope = root.paper_id
      const allRows = listNotesStmt.all({ paperId: paperScope }) as NoteRow[]
      const byId = new Map(allRows.map((r) => [r.id, r]))

      const subtree = new Set<string>()
      const stack = [noteId]
      while (stack.length) {
        const id = stack.pop()!
        if (!byId.has(id)) continue
        if (subtree.has(id)) continue
        subtree.add(id)
        for (const r of allRows) {
          if (r.parent_id === id) stack.push(r.id)
        }
      }

      const depthMemo = new Map<string, number>()
      const depthOf = (id: string): number => {
        if (depthMemo.has(id)) return depthMemo.get(id)!
        const row = byId.get(id)
        if (!row || !row.parent_id) {
          depthMemo.set(id, 0)
          return 0
        }
        const d = depthOf(row.parent_id) + 1
        depthMemo.set(id, d)
        return d
      }

      const ordered = [...subtree].sort((a, b) => depthOf(b) - depthOf(a))

      for (const id of ordered) {
        deleteNoteByIdStmt.run(id)
      }
      return ordered
    },
    setNoteParent(input) {
      const row = getNoteStmt.get(input.noteId) as NoteRow | undefined
      if (!row) return null

      const paperScope = row.paper_id
      const allRows = listNotesStmt.all({ paperId: paperScope }) as NoteRow[]

      const subtree = new Set<string>()
      const stack = [input.noteId]
      while (stack.length) {
        const id = stack.pop()!
        if (subtree.has(id)) continue
        subtree.add(id)
        for (const r of allRows) {
          if (r.parent_id === id) stack.push(r.id)
        }
      }

      if (input.parentId !== null) {
        if (input.parentId === input.noteId) return null
        if (subtree.has(input.parentId)) return null

        const parentRow = getNoteStmt.get(input.parentId) as NoteRow | undefined
        if (!parentRow || parentRow.is_group !== 1) return null
        if (row.paper_id !== parentRow.paper_id) return null
      }

      updateNoteParentStmt.run({
        parent_id: input.parentId,
        id: input.noteId,
        updated_at: Date.now()
      })
      return mapNote(getNoteStmt.get(input.noteId) as NoteRow)
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
