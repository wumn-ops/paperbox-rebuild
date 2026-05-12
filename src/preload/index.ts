import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiSettings,
  BootstrapData,
  ConversationDetail,
  ConversationSummary,
  ExportConversationResult,
  FolderItem,
  ImportPapersResult,
  LibraryQuery,
  NoteItem,
  PaperDetail,
  PaperSummary,
  TagItem
} from '../shared/contracts'

const api = {
  getBootstrap: () => ipcRenderer.invoke('app:get-bootstrap') as Promise<BootstrapData>,
  queryPapers: (query: LibraryQuery) =>
    ipcRenderer.invoke('library:query-papers', query) as Promise<PaperSummary[]>,
  getPaperDetail: (id: string) =>
    ipcRenderer.invoke('library:get-paper-detail', id) as Promise<PaperDetail | null>,
  importPapers: () => ipcRenderer.invoke('library:import-papers') as Promise<ImportPapersResult>,
  saveAiSummary: (input: { paperId: string; summary: string }) =>
    ipcRenderer.invoke('library:save-ai-summary', input) as Promise<PaperDetail | null>,
  listFolders: () => ipcRenderer.invoke('workspace:list-folders') as Promise<FolderItem[]>,
  createFolder: (input: { name: string; parentId?: string | null }) =>
    ipcRenderer.invoke('workspace:create-folder', input) as Promise<FolderItem>,
  listTags: () => ipcRenderer.invoke('workspace:list-tags') as Promise<TagItem[]>,
  createTag: (input: { name: string; color?: string }) =>
    ipcRenderer.invoke('workspace:create-tag', input) as Promise<TagItem>,
  setPaperFolder: (input: { paperId: string; folderId: string | null }) =>
    ipcRenderer.invoke('workspace:set-paper-folder', input) as Promise<boolean>,
  setPaperTags: (input: { paperId: string; tagIds: string[] }) =>
    ipcRenderer.invoke('workspace:set-paper-tags', input) as Promise<boolean>,
  listNotes: (paperId: string | null) =>
    ipcRenderer.invoke('workspace:list-notes', paperId) as Promise<NoteItem[]>,
  createNote: (input: { paperId: string | null; parentId?: string | null; title: string; isGroup: boolean }) =>
    ipcRenderer.invoke('workspace:create-note', input) as Promise<NoteItem>,
  updateNote: (input: { id: string; title: string; content: string }) =>
    ipcRenderer.invoke('workspace:update-note', input) as Promise<NoteItem | null>,
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings') as Promise<AiSettings>,
  saveAiPreset: (input: { id?: string; name: string; apiKey: string; baseUrl: string; model: string; provider: string }) =>
    ipcRenderer.invoke('ai:save-preset', input) as Promise<AiSettings>,
  setActiveAiPreset: (id: string) => ipcRenderer.invoke('ai:set-active-preset', id) as Promise<AiSettings>,
  listConversations: () => ipcRenderer.invoke('ai:list-conversations') as Promise<ConversationSummary[]>,
  createConversation: (input: { name?: string; paperIds: string[] }) =>
    ipcRenderer.invoke('ai:create-conversation', input) as Promise<ConversationDetail>,
  getConversation: (id: string) => ipcRenderer.invoke('ai:get-conversation', id) as Promise<ConversationDetail | null>,
  updateConversationPapers: (input: { conversationId: string; paperIds: string[] }) =>
    ipcRenderer.invoke('ai:update-conversation-papers', input) as Promise<ConversationDetail | null>,
  sendAiMessage: (input: { conversationId: string; content: string }) =>
    ipcRenderer.invoke('ai:send-message', input) as Promise<ConversationDetail>,
  exportConversation: (conversationId: string) =>
    ipcRenderer.invoke('ai:export-conversation', conversationId) as Promise<ExportConversationResult | null>
}

contextBridge.exposeInMainWorld('paperbox', api)

export type PaperboxApi = typeof api
