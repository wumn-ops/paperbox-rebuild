import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import type { DatabaseContext } from './database'
import { extractDocumentContent } from './document-parser'
import type {
  ImportPapersResult,
  ImportedPaper,
  LibraryQuery,
  PaperDetail,
  PaperSummary,
  SkippedPaper,
  TagRef
} from '../../shared/contracts'

interface CreateLibraryServiceOptions {
  filesDir: string
}

interface PaperRow {
  id: string
  title: string
  authors: string | null
  year: number | null
  source_name: string | null
  abstract: string | null
  keywords: string | null
  doi: string | null
  ai_summary: string | null
  file_path: string
  file_type: string
  file_size: number | null
  file_hash: string | null
  file_content: string | null
  created_at: number
  updated_at: number
  match_context?: string | null
  folder_id?: string | null
  tag_ids?: string | null
  tag_names?: string | null
  tag_colors?: string | null
}

export interface LibraryService {
  filesDir: string
  importPapers(): Promise<ImportPapersResult>
  queryPapers(query: LibraryQuery): PaperSummary[]
  getPaperDetail(id: string): PaperDetail | null
  saveAiSummary(input: { paperId: string; summary: string }): PaperDetail | null
}

export function createLibraryService(
  database: DatabaseContext,
  options: CreateLibraryServiceOptions
): LibraryService {
  ensureDirectory(options.filesDir)

  const listPapersStmt = database.db.prepare(`
    SELECT
      papers.id,
      papers.title,
      papers.authors,
      papers.year,
      papers.source_name,
      papers.file_type,
      papers.updated_at,
      papers.created_at,
      COALESCE(substr(papers.file_content, 1, 180), '') AS match_context
    FROM papers
    LEFT JOIN paper_folders pf ON pf.paper_id = papers.id
    WHERE (@fileType = 'all' OR papers.file_type = @fileType)
      AND (@folderId = 'all' OR pf.folder_id = @folderId)
      AND (
        @tagId = 'all'
        OR EXISTS (
          SELECT 1
          FROM paper_tags pt
          WHERE pt.paper_id = papers.id AND pt.tag_id = @tagId
        )
      )
    GROUP BY papers.id
    ORDER BY papers.updated_at DESC, papers.created_at DESC
  `)

  const searchPapersStmt = database.db.prepare(`
    SELECT
      p.id,
      p.title,
      p.authors,
      p.year,
      p.source_name,
      p.file_type,
      p.updated_at,
      p.created_at,
      snippet(papers_fts, 5, '', '', ' … ', 18) AS match_context
    FROM papers p
    JOIN papers_fts ON papers_fts.paper_id = p.id
    LEFT JOIN paper_folders pf ON pf.paper_id = p.id
    WHERE papers_fts MATCH @ftsQuery
      AND (@fileType = 'all' OR p.file_type = @fileType)
      AND (@folderId = 'all' OR pf.folder_id = @folderId)
      AND (
        @tagId = 'all'
        OR EXISTS (
          SELECT 1
          FROM paper_tags pt
          WHERE pt.paper_id = p.id AND pt.tag_id = @tagId
        )
      )
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.created_at DESC
  `)

  const fallbackSearchStmt = database.db.prepare(`
    SELECT
      papers.id,
      papers.title,
      papers.authors,
      papers.year,
      papers.source_name,
      papers.file_type,
      papers.updated_at,
      papers.created_at,
      COALESCE(substr(papers.file_content, 1, 180), '') AS match_context
    FROM papers
    LEFT JOIN paper_folders pf ON pf.paper_id = papers.id
    WHERE (
      papers.title LIKE @likeQuery
      OR COALESCE(papers.authors, '') LIKE @likeQuery
      OR COALESCE(papers.source_name, '') LIKE @likeQuery
      OR COALESCE(papers.file_content, '') LIKE @likeQuery
    )
      AND (@fileType = 'all' OR papers.file_type = @fileType)
      AND (@folderId = 'all' OR pf.folder_id = @folderId)
      AND (
        @tagId = 'all'
        OR EXISTS (
          SELECT 1
          FROM paper_tags pt
          WHERE pt.paper_id = papers.id AND pt.tag_id = @tagId
        )
      )
    GROUP BY papers.id
    ORDER BY papers.updated_at DESC, papers.created_at DESC
  `)

  const getPaperDetailStmt = database.db.prepare(`
    SELECT
      papers.id,
      papers.title,
      papers.authors,
      papers.year,
      papers.source_name,
      papers.abstract,
      papers.keywords,
      papers.doi,
      papers.ai_summary,
      papers.file_path,
      papers.file_type,
      papers.file_size,
      papers.file_hash,
      papers.file_content,
      (SELECT folder_id FROM paper_folders WHERE paper_id = papers.id LIMIT 1) AS folder_id,
      (SELECT GROUP_CONCAT(tags.id, ',') FROM tags
        JOIN paper_tags pt ON pt.tag_id = tags.id
        WHERE pt.paper_id = papers.id) AS tag_ids,
      (SELECT GROUP_CONCAT(tags.name, ',') FROM tags
        JOIN paper_tags pt ON pt.tag_id = tags.id
        WHERE pt.paper_id = papers.id) AS tag_names,
      (SELECT GROUP_CONCAT(tags.color, ',') FROM tags
        JOIN paper_tags pt ON pt.tag_id = tags.id
        WHERE pt.paper_id = papers.id) AS tag_colors,
      papers.updated_at,
      papers.created_at
    FROM papers
    WHERE papers.id = ?
  `)

  const findByHashStmt = database.db.prepare(`
    SELECT id, title, source_name
    FROM papers
    WHERE file_hash = ?
    LIMIT 1
  `)

  const insertPaperStmt = database.db.prepare(`
    INSERT INTO papers (
      id,
      title,
      authors,
      year,
      source_name,
      abstract,
      keywords,
      doi,
      ai_summary,
      file_path,
      file_type,
      file_size,
      file_hash,
      file_content,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @title,
      @authors,
      @year,
      @source_name,
      @abstract,
      @keywords,
      @doi,
      @ai_summary,
      @file_path,
      @file_type,
      @file_size,
      @file_hash,
      @file_content,
      @created_at,
      @updated_at
    )
  `)

  const insertPaperFtsStmt = database.db.prepare(`
    INSERT INTO papers_fts (
      paper_id,
      title,
      authors,
      abstract,
      keywords,
      file_content
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  const updateAiSummaryStmt = database.db.prepare(`
    UPDATE papers
    SET ai_summary = ?,
        updated_at = ?
    WHERE id = ?
  `)

  return {
    filesDir: options.filesDir,
    async importPapers() {
      const selection = await dialog.showOpenDialog({
        title: '导入文献或文档',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'docx', 'doc', 'xlsx', 'xls', 'csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (selection.canceled || selection.filePaths.length === 0) {
        return { imported: [], skipped: [], canceled: true }
      }

      const imported: ImportedPaper[] = []
      const skipped: SkippedPaper[] = []

      for (const sourcePath of selection.filePaths) {
        const sourceName = basename(sourcePath)
        try {
          const fileBuffer = await readFile(sourcePath)
          const fileHash = createHash('sha256').update(fileBuffer).digest('hex')
          const duplicate = findByHashStmt.get(fileHash) as
            | { id: string; title: string; source_name: string | null }
            | undefined

          if (duplicate) {
            skipped.push({ sourceName, reason: `已存在相同文件：${duplicate.title}` })
            continue
          }

          const ext = extname(sourcePath).toLowerCase()
          const now = Date.now()
          const id = randomUUID()
          const storedName = `${id}${ext}`
          const targetPath = join(options.filesDir, storedName)
          const stats = statSync(sourcePath)

          copyFileSync(sourcePath, targetPath)

          const title = basename(sourceName, ext) || sourceName
          const fileContent = await extractDocumentContent(fileBuffer, ext)

          const row = {
            id,
            title,
            authors: null,
            year: null,
            source_name: sourceName,
            abstract: null,
            keywords: null,
            doi: null,
            ai_summary: null,
            file_path: targetPath,
            file_type: normalizeFileType(ext),
            file_size: stats.size,
            file_hash: fileHash,
            file_content: fileContent,
            created_at: now,
            updated_at: now
          }

          insertPaperStmt.run(row)
          insertPaperFtsStmt.run(
            row.id,
            row.title,
            row.authors,
            row.abstract,
            row.keywords,
            row.file_content
          )

          imported.push({ id, title, sourceName })
        } catch (error) {
          skipped.push({ sourceName, reason: error instanceof Error ? error.message : '导入失败' })
        }
      }

      return { imported, skipped, canceled: false }
    },
    queryPapers(query) {
      const keyword = query.keyword.trim()
      const fileType = query.fileType || 'all'
      const folderId = query.folderId || 'all'
      const tagId = query.tagId || 'all'

      if (!keyword) {
        const rows = listPapersStmt.all({ fileType, folderId, tagId }) as PaperRow[]
        return rows.map(mapSummary)
      }

      const ftsQuery = buildFtsQuery(keyword)
      try {
        const rows = searchPapersStmt.all({ ftsQuery, fileType, folderId, tagId }) as PaperRow[]
        if (rows.length > 0) {
          return rows.map(mapSummary)
        }
      } catch (error) {
        console.warn('FTS search failed, falling back to LIKE search:', error)
      }

      const likeQuery = `%${keyword}%`
      const fallbackRows = fallbackSearchStmt.all({
        likeQuery,
        fileType,
        folderId,
        tagId
      }) as PaperRow[]
      return fallbackRows.map(mapSummary)
    },
    getPaperDetail(id: string) {
      const row = getPaperDetailStmt.get(id) as PaperRow | undefined
      return row ? mapDetail(row) : null
    },
    saveAiSummary(input) {
      updateAiSummaryStmt.run(input.summary, Date.now(), input.paperId)
      const row = getPaperDetailStmt.get(input.paperId) as PaperRow | undefined
      return row ? mapDetail(row) : null
    }
  }
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function normalizeFileType(ext: string): string {
  return ext.replace('.', '').toLowerCase() || 'unknown'
}

function buildFtsQuery(keyword: string): string {
  return keyword
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(' AND ')
}

function mapSummary(row: PaperRow): PaperSummary {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    fileType: row.file_type,
    sourceName: row.source_name,
    matchContext: row.match_context ?? null,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  }
}

function mapDetail(row: PaperRow): PaperDetail {
  return {
    ...mapSummary(row),
    abstract: row.abstract,
    keywords: row.keywords,
    doi: row.doi,
    aiSummary: row.ai_summary,
    filePath: row.file_path,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    fileContent: row.file_content,
    folderId: row.folder_id ?? null,
    tagIds: mapTagRefs(row)
  }
}

function mapTagRefs(row: PaperRow): TagRef[] {
  if (!row.tag_ids || !row.tag_names || !row.tag_colors) return []
  const ids = row.tag_ids.split(',')
  const names = row.tag_names.split(',')
  const colors = row.tag_colors.split(',')
  return ids.map((id, index) => ({
    id,
    name: names[index] ?? '',
    color: colors[index] ?? '#2563eb'
  }))
}
