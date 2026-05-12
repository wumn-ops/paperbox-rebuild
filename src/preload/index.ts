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
  renamePaper: (input: { paperId: string; title: string }) =>
    ipcRenderer.invoke('library:rename-paper', input) as Promise<PaperDetail | null>,
  deletePaper: (paperId: string) => ipcRenderer.invoke('library:delete-paper', paperId) as Promise<boolean>,
  listFolders: () => ipcRenderer.invoke('workspace:list-folders') as Promise<FolderItem[]>,
  createFolder: (input: { name: string; parentId?: string | null }) =>
    ipcRenderer.invoke('workspace:create-folder', input) as Promise<FolderItem>,
  renameFolder: (input: { folderId: string; name: string }) =>
    ipcRenderer.invoke('workspace:rename-folder', input) as Promise<FolderItem | null>,
  deleteFolder: (folderId: string) => ipcRenderer.invoke('workspace:delete-folder', folderId) as Promise<boolean>,
  listTags: () => ipcRenderer.invoke('workspace:list-tags') as Promise<TagItem[]>,
  createTag: (input: { name: string; color?: string }) =>
    ipcRenderer.invoke('workspace:create-tag', input) as Promise<TagItem>,
  renameTag: (input: { tagId: string; name: string }) =>
    ipcRenderer.invoke('workspace:rename-tag', input) as Promise<TagItem | null>,
  deleteTag: (tagId: string) => ipcRenderer.invoke('workspace:delete-tag', tagId) as Promise<boolean>,
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
  deleteNote: (noteId: string) => ipcRenderer.invoke('workspace:delete-note', noteId) as Promise<boolean>,
  setNoteParent: (input: { noteId: string; parentId: string | null }) =>
    ipcRenderer.invoke('workspace:set-note-parent', input) as Promise<NoteItem | null>,
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings') as Promise<AiSettings>,
  saveAiPreset: (input: { id?: string; name: string; apiKey: string; baseUrl: string; model: string; provider: string }) =>
    ipcRenderer.invoke('ai:save-preset', input) as Promise<AiSettings>,
  setActiveAiPreset: (id: string) => ipcRenderer.invoke('ai:set-active-preset', id) as Promise<AiSettings>,
  listConversations: () => ipcRenderer.invoke('ai:list-conversations') as Promise<ConversationSummary[]>,
  createConversation: (input: { name?: string; paperIds: string[]; noteIds?: string[] }) =>
    ipcRenderer.invoke('ai:create-conversation', input) as Promise<ConversationDetail>,
  getConversation: (id: string) => ipcRenderer.invoke('ai:get-conversation', id) as Promise<ConversationDetail | null>,
  renameConversation: (input: { conversationId: string; name: string }) =>
    ipcRenderer.invoke('ai:rename-conversation', input) as Promise<ConversationDetail | null>,
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('ai:delete-conversation', conversationId) as Promise<boolean>,
  updateConversationPapers: (input: { conversationId: string; paperIds: string[] }) =>
    ipcRenderer.invoke('ai:update-conversation-papers', input) as Promise<ConversationDetail | null>,
  updateConversationNotes: (input: { conversationId: string; noteIds: string[] }) =>
    ipcRenderer.invoke('ai:update-conversation-notes', input) as Promise<ConversationDetail | null>,
  sendAiMessage: (input: { conversationId: string; content: string }) =>
    ipcRenderer.invoke('ai:send-message', input) as Promise<ConversationDetail>,
  exportConversation: (conversationId: string) =>
    ipcRenderer.invoke('ai:export-conversation', conversationId) as Promise<ExportConversationResult | null>
}

contextBridge.exposeInMainWorld('paperbox', api)

export type PaperboxApi = typeof api
