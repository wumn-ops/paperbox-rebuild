export interface BootstrapData {
  appName: string
  dbPath: string
  libraryRoot: string
}

export interface FolderRef {
  id: string
  name: string
}

export interface TagRef {
  id: string
  name: string
  color: string
}

export interface PaperSummary {
  id: string
  title: string
  authors: string | null
  year: number | null
  fileType: string
  sourceName: string | null
  matchContext?: string | null
  updatedAt: number
  createdAt: number
}

export interface PaperDetail extends PaperSummary {
  abstract: string | null
  keywords: string | null
  doi: string | null
  aiSummary: string | null
  filePath: string
  fileSize: number | null
  fileHash: string | null
  fileContent: string | null
  folderId: string | null
  tagIds: TagRef[]
}

export interface ImportedPaper {
  id: string
  title: string
  sourceName: string
}

export interface SkippedPaper {
  sourceName: string
  reason: string
}

export interface ImportPapersResult {
  imported: ImportedPaper[]
  skipped: SkippedPaper[]
  canceled: boolean
}

export interface LibraryQuery {
  keyword: string
  fileType: string
  folderId: string
  tagId: string
}

export interface FolderItem {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  createdAt: number
  paperCount: number
}

export interface TagItem {
  id: string
  name: string
  color: string
  createdAt: number
  paperCount: number
}

export interface NoteItem {
  id: string
  paperId: string | null
  parentId: string | null
  title: string
  content: string
  isGroup: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface AiPreset {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model: string
  provider: string
  isBuiltin: boolean
  createdAt: number
}

export interface AiSettings {
  activePresetId: string
  presets: AiPreset[]
}

export interface ConversationSummary {
  id: string
  name: string
  paperIds: string[]
  noteIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface ConversationDetail {
  conversation: ConversationSummary
  messages: ConversationMessage[]
  papers: PaperSummary[]
  /** 已选入会话上下文的笔记（非分组），含正文供模型使用 */
  contextNotes: NoteItem[]
}

export interface ExportConversationResult {
  filePath: string
}
