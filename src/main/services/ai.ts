import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import OpenAI from 'openai'
import type { DatabaseContext } from './database'
import type {
  AiPreset,
  AiSettings,
  ConversationDetail,
  ConversationMessage,
  ConversationSummary,
  ExportConversationResult,
  NoteItem,
  PaperSummary
} from '../../shared/contracts'

interface PresetRow {
  id: string
  name: string
  api_key: string
  base_url: string
  model: string
  provider: string
  is_builtin: number
  created_at: number
}

interface ConversationRow {
  id: string
  name: string
  paper_ids: string
  note_ids: string
  created_at: number
  updated_at: number
}

interface CtxNoteRow {
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

interface MessageRow {
  id: string
  conversation_id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  created_at: number
}

interface PaperRow {
  id: string
  title: string
  authors: string | null
  year: number | null
  source_name: string | null
  file_type: string
  updated_at: number
  created_at: number
  abstract: string | null
  keywords: string | null
  file_content: string | null
}

const BUILTIN_PRESETS = [
  {
    id: 'preset-openai-gpt-4o-mini',
    name: 'OpenAI GPT-4o mini',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    provider: 'openai'
  },
  {
    id: 'preset-qwen-plus',
    name: 'Qwen Plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    provider: 'qwen'
  },
  {
    id: 'preset-ollama-llama3',
    name: 'Local Ollama Llama3',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    provider: 'ollama'
  }
] as const

export interface AiService {
  getSettings(): AiSettings
  savePreset(input: { id?: string; name: string; apiKey: string; baseUrl: string; model: string; provider: string }): AiSettings
  setActivePreset(id: string): AiSettings
  listConversations(): ConversationSummary[]
  createConversation(input: { name?: string; paperIds: string[]; noteIds?: string[] }): ConversationDetail
  getConversation(id: string): ConversationDetail | null
  renameConversation(input: { conversationId: string; name: string }): ConversationDetail | null
  deleteConversation(conversationId: string): boolean
  updateConversationPapers(input: { conversationId: string; paperIds: string[] }): ConversationDetail | null
  updateConversationNotes(input: { conversationId: string; noteIds: string[] }): ConversationDetail | null
  removePaperIdFromAllConversations(paperId: string): void
  removeNoteIdFromAllConversations(noteId: string): void
  sendMessage(input: { conversationId: string; content: string }): Promise<ConversationDetail>
  exportConversation(conversationId: string): Promise<ExportConversationResult | null>
}

export function createAiService(database: DatabaseContext): AiService {
  const insertBuiltinStmt = database.db.prepare(`
    INSERT OR IGNORE INTO ai_presets (
      id, name, api_key, base_url, model, provider, is_builtin, created_at
    ) VALUES (
      @id, @name, '', @base_url, @model, @provider, 1, @created_at
    )
  `)

  const listPresetsStmt = database.db.prepare(`
    SELECT id, name, api_key, base_url, model, provider, is_builtin, created_at
    FROM ai_presets
    ORDER BY is_builtin DESC, created_at ASC
  `)

  const upsertPresetStmt = database.db.prepare(`
    INSERT INTO ai_presets (
      id, name, api_key, base_url, model, provider, is_builtin, created_at
    ) VALUES (
      @id, @name, @api_key, @base_url, @model, @provider, @is_builtin, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      api_key = excluded.api_key,
      base_url = excluded.base_url,
      model = excluded.model,
      provider = excluded.provider
  `)

  const setSettingStmt = database.db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  const getSettingStmt = database.db.prepare(`SELECT value FROM settings WHERE key = ?`)

  const listConversationsStmt = database.db.prepare(`
    SELECT id, name, paper_ids, note_ids, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC, created_at DESC
  `)

  const insertConversationStmt = database.db.prepare(`
    INSERT INTO conversations (
      id, name, paper_ids, note_ids, created_at, updated_at, sort_order
    ) VALUES (
      @id, @name, @paper_ids, @note_ids, @created_at, @updated_at, @sort_order
    )
  `)

  const getConversationStmt = database.db.prepare(`
    SELECT id, name, paper_ids, note_ids, created_at, updated_at
    FROM conversations
    WHERE id = ?
  `)

  const updateConversationStmt = database.db.prepare(`
    UPDATE conversations
    SET name = @name,
        paper_ids = @paper_ids,
        note_ids = @note_ids,
        updated_at = @updated_at
    WHERE id = @id
  `)

  const deleteConversationStmt = database.db.prepare(`DELETE FROM conversations WHERE id = ?`)

  const listMessagesStmt = database.db.prepare(`
    SELECT id, conversation_id, role, content, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `)

  const insertMessageStmt = database.db.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, content, created_at
    ) VALUES (
      @id, @conversation_id, @role, @content, @created_at
    )
  `)

  const listPapersByIdsStmt = database.db.prepare(`
    SELECT id, title, authors, year, source_name, file_type, updated_at, created_at, abstract, keywords, file_content
    FROM papers
    WHERE id = ?
  `)

  const listConversationContextRefsStmt = database.db.prepare(
    `SELECT id, name, paper_ids, note_ids FROM conversations`
  )

  const getNoteForContextStmt = database.db.prepare(`
    SELECT id, paper_id, parent_id, title, content, is_group, sort_order, created_at, updated_at
    FROM notes
    WHERE id = ?
  `)

  ensureBuiltinPresets()
  ensureActivePreset()

  return {
    getSettings() {
      return {
        activePresetId: getActivePresetId(),
        presets: listPresets()
      }
    },
    savePreset(input) {
      const id = input.id ?? randomUUID()
      upsertPresetStmt.run({
        id,
        name: input.name,
        api_key: input.apiKey,
        base_url: input.baseUrl,
        model: input.model,
        provider: input.provider,
        is_builtin: 0,
        created_at: Date.now()
      })

      if (!input.id) {
        setSettingStmt.run('active_preset_id', id)
      }

      return {
        activePresetId: getActivePresetId(),
        presets: listPresets()
      }
    },
    setActivePreset(id) {
      setSettingStmt.run('active_preset_id', id)
      return {
        activePresetId: getActivePresetId(),
        presets: listPresets()
      }
    },
    listConversations() {
      return (listConversationsStmt.all() as ConversationRow[]).map(mapConversation)
    },
    createConversation(input) {
      const now = Date.now()
      const id = randomUUID()
      const paperIds = input.paperIds
      const noteIds = input.noteIds ?? []
      insertConversationStmt.run({
        id,
        name: input.name?.trim() || buildConversationName(paperIds.length, noteIds.length),
        paper_ids: JSON.stringify(paperIds),
        note_ids: JSON.stringify(noteIds),
        created_at: now,
        updated_at: now,
        sort_order: now
      })
      return getConversationDetail(id)!
    },
    getConversation(id) {
      return getConversationDetail(id)
    },
    renameConversation(input) {
      const current = getConversationStmt.get(input.conversationId) as ConversationRow | undefined
      if (!current) return null
      const trimmed = input.name.trim()
      if (!trimmed) {
        throw new Error('会话名称不能为空')
      }
      updateConversationStmt.run({
        id: current.id,
        name: trimmed,
        paper_ids: current.paper_ids,
        note_ids: current.note_ids ?? '[]',
        updated_at: Date.now()
      })
      return getConversationDetail(input.conversationId)
    },
    deleteConversation(conversationId) {
      const current = getConversationStmt.get(conversationId) as ConversationRow | undefined
      if (!current) return false
      deleteConversationStmt.run(conversationId)
      return true
    },
    updateConversationPapers(input) {
      const current = getConversationStmt.get(input.conversationId) as ConversationRow | undefined
      if (!current) return null
      updateConversationStmt.run({
        id: current.id,
        name: current.name,
        paper_ids: JSON.stringify(input.paperIds),
        note_ids: current.note_ids ?? '[]',
        updated_at: Date.now()
      })
      return getConversationDetail(input.conversationId)
    },
    updateConversationNotes(input) {
      const current = getConversationStmt.get(input.conversationId) as ConversationRow | undefined
      if (!current) return null
      updateConversationStmt.run({
        id: current.id,
        name: current.name,
        paper_ids: current.paper_ids,
        note_ids: JSON.stringify(input.noteIds),
        updated_at: Date.now()
      })
      return getConversationDetail(input.conversationId)
    },
    removePaperIdFromAllConversations(paperId) {
      const rows = listConversationContextRefsStmt.all() as {
        id: string
        name: string
        paper_ids: string
        note_ids: string
      }[]
      const now = Date.now()
      for (const row of rows) {
        let ids: string[]
        try {
          ids = JSON.parse(row.paper_ids) as string[]
        } catch {
          continue
        }
        if (!Array.isArray(ids) || !ids.includes(paperId)) continue
        const next = ids.filter((x) => x !== paperId)
        updateConversationStmt.run({
          id: row.id,
          name: row.name,
          paper_ids: JSON.stringify(next),
          note_ids: row.note_ids ?? '[]',
          updated_at: now
        })
      }
    },
    removeNoteIdFromAllConversations(noteId) {
      const rows = listConversationContextRefsStmt.all() as {
        id: string
        name: string
        paper_ids: string
        note_ids: string
      }[]
      const now = Date.now()
      for (const row of rows) {
        let ids: string[]
        try {
          ids = JSON.parse(row.note_ids || '[]') as string[]
        } catch {
          continue
        }
        if (!Array.isArray(ids) || !ids.includes(noteId)) continue
        const next = ids.filter((x) => x !== noteId)
        updateConversationStmt.run({
          id: row.id,
          name: row.name,
          paper_ids: row.paper_ids,
          note_ids: JSON.stringify(next),
          updated_at: now
        })
      }
    },
    async sendMessage(input) {
      const detail = getConversationDetail(input.conversationId)
      if (!detail) {
        throw new Error('Conversation not found')
      }

      const preset = getActivePreset()
      if (!preset.apiKey.trim()) {
        throw new Error('Active preset is missing an API key. Open Settings and configure one first.')
      }

      const now = Date.now()
      insertMessageStmt.run({
        id: randomUUID(),
        conversation_id: input.conversationId,
        role: 'user',
        content: input.content,
        created_at: now
      })

      const updatedDetail = getConversationDetail(input.conversationId)!
      const assistantText = await generateAssistantReply(preset, updatedDetail, input.content)

      insertMessageStmt.run({
        id: randomUUID(),
        conversation_id: input.conversationId,
        role: 'assistant',
        content: assistantText,
        created_at: Date.now()
      })

      updateConversationStmt.run({
        id: updatedDetail.conversation.id,
        name: updatedDetail.conversation.name,
        paper_ids: JSON.stringify(updatedDetail.conversation.paperIds),
        note_ids: JSON.stringify(updatedDetail.conversation.noteIds),
        updated_at: Date.now()
      })

      return getConversationDetail(input.conversationId)!
    },
    async exportConversation(conversationId) {
      const detail = getConversationDetail(conversationId)
      if (!detail) return null

      const saveResult = await dialog.showSaveDialog({
        title: 'Export conversation',
        defaultPath: `${sanitizeFileName(detail.conversation.name)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return null
      }

      const markdown = renderConversationMarkdown(detail)
      await writeFile(saveResult.filePath, markdown, 'utf-8')
      return { filePath: saveResult.filePath }
    }
  }

  function ensureBuiltinPresets(): void {
    for (const preset of BUILTIN_PRESETS) {
      insertBuiltinStmt.run({
        id: preset.id,
        name: preset.name,
        base_url: preset.baseUrl,
        model: preset.model,
        provider: preset.provider,
        created_at: Date.now()
      })
    }
  }

  function ensureActivePreset(): void {
    const active = getSettingStmt.get('active_preset_id') as { value: string } | undefined
    if (!active) {
      setSettingStmt.run('active_preset_id', BUILTIN_PRESETS[0].id)
    }
  }

  function getActivePresetId(): string {
    const active = getSettingStmt.get('active_preset_id') as { value: string } | undefined
    return active?.value ?? BUILTIN_PRESETS[0].id
  }

  function listPresets(): AiPreset[] {
    return (listPresetsStmt.all() as PresetRow[]).map(mapPreset)
  }

  function getActivePreset(): AiPreset {
    const activeId = getActivePresetId()
    const preset = listPresets().find((item) => item.id === activeId)
    if (!preset) {
      throw new Error('Active preset not found')
    }
    return preset
  }

  function getConversationDetail(id: string): ConversationDetail | null {
    const conversation = getConversationStmt.get(id) as ConversationRow | undefined
    if (!conversation) return null
    const mapped = mapConversation(conversation)
    const messages = (listMessagesStmt.all(id) as MessageRow[]).map(mapMessage)
    const papers = mapped.paperIds
      .map((paperId) => listPapersByIdsStmt.get(paperId) as PaperRow | undefined)
      .filter(Boolean)
      .map((row) => mapPaperSummary(row as PaperRow))
    const contextNotes: NoteItem[] = []
    for (const nid of mapped.noteIds) {
      const nrow = getNoteForContextStmt.get(nid) as CtxNoteRow | undefined
      if (!nrow || nrow.is_group === 1) continue
      contextNotes.push(mapCtxNote(nrow))
    }
    return {
      conversation: mapped,
      messages,
      papers,
      contextNotes
    }
  }

  async function generateAssistantReply(
    preset: AiPreset,
    detail: ConversationDetail,
    userMessage: string
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: preset.apiKey,
      baseURL: preset.baseUrl
    })

    const messages = [
      {
        role: 'system' as const,
        content: buildSystemPrompt(detail)
      },
      ...detail.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role,
          content: message.content
        })),
      {
        role: 'user' as const,
        content: userMessage
      }
    ]

    const completion = await client.chat.completions.create({
      model: preset.model,
      messages
    })

    return completion.choices[0]?.message?.content?.trim() || 'No response returned from the model.'
  }

  function buildSystemPrompt(detail: ConversationDetail): string {
    const contextPapers = detail.papers
      .map((paper) => {
        const row = listPapersByIdsStmt.get(paper.id) as PaperRow | undefined
        const abstract = row?.abstract ? `Abstract: ${row.abstract}` : ''
        const keywords = row?.keywords ? `Keywords: ${row.keywords}` : ''
        const content = row?.file_content ? `Content excerpt: ${row.file_content.slice(0, 3000)}` : ''
        return [`Title: ${paper.title}`, paper.authors ? `Authors: ${paper.authors}` : '', abstract, keywords, content]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n---\n\n')

    const contextNotesBlock = detail.contextNotes
      .map((note) => {
        const excerpt = note.content ? `Content:\n${note.content.slice(0, 4000)}` : ''
        return [`Note title: ${note.title}`, excerpt].filter(Boolean).join('\n')
      })
      .join('\n\n---\n\n')

    return [
      'You are an academic reading assistant inside PaperBox.',
      'Use the selected papers and the user notebook excerpts as primary context when answering.',
      'If the context is missing information, say so clearly instead of inventing details.',
      contextPapers ? `Selected paper context:\n\n${contextPapers}` : 'No paper context is attached to this conversation.',
      contextNotesBlock ? `Selected notebook entries (user notes):\n\n${contextNotesBlock}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}

function renderConversationMarkdown(detail: ConversationDetail): string {
  const paperLine =
    detail.papers.length > 0 ? detail.papers.map((paper) => paper.title).join(', ') : 'No paper context attached'

  const noteLine =
    detail.contextNotes.length > 0
      ? detail.contextNotes.map((note) => note.title).join(', ')
      : 'No notes in context'

  const messageBlocks = detail.messages
    .map((message) => {
      const timestamp = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(message.createdAt)

      return [`## ${timestamp}`, `**${message.role.toUpperCase()}**`, '', message.content].join('\n')
    })
    .join('\n\n')

  return [`# ${detail.conversation.name}`, '', `Context papers: ${paperLine}`, `Context notes: ${noteLine}`, '', messageBlocks].join(
    '\n'
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'conversation'
}

function mapPreset(row: PresetRow): AiPreset {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    model: row.model,
    provider: row.provider,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at
  }
}

function mapConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    name: row.name,
    paperIds: parseJsonStringArray(row.paper_ids),
    noteIds: parseJsonStringArray(row.note_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  }
}

function mapPaperSummary(row: PaperRow): PaperSummary {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    fileType: row.file_type,
    sourceName: row.source_name,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  }
}

function buildConversationName(paperCount: number, noteCount: number = 0): string {
  if (paperCount > 0 && noteCount > 0) return `会话 · ${paperCount} 文献 · ${noteCount} 笔记`
  if (paperCount > 0) return `Chat with ${paperCount} paper(s)`
  if (noteCount > 0) return `会话 · ${noteCount} 条笔记`
  return 'New Conversation'
}

function parseJsonStringArray(json: string | null | undefined): string[] {
  if (json == null || json === '') return []
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function mapCtxNote(row: CtxNoteRow): NoteItem {
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
