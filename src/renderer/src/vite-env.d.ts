/// <reference types="vite/client" />

import type {
  AiSettings,
  BootstrapData,
  ConversationDetail,
  ConversationSummary,
  FolderItem,
  ImportPapersResult,
  LibraryQuery,
  NoteItem,
  PaperDetail,
  PaperSummary,
  TagItem
} from '../../shared/contracts'

declare global {
  interface Window {
    paperbox: {
      getBootstrap: () => Promise<BootstrapData>
      queryPapers: (query: LibraryQuery) => Promise<PaperSummary[]>
      getPaperDetail: (id: string) => Promise<PaperDetail | null>
      importPapers: () => Promise<ImportPapersResult>
      saveAiSummary: (input: { paperId: string; summary: string }) => Promise<PaperDetail | null>
      renamePaper: (input: { paperId: string; title: string }) => Promise<PaperDetail | null>
      deletePaper: (paperId: string) => Promise<boolean>
      listFolders: () => Promise<FolderItem[]>
      createFolder: (input: { name: string; parentId?: string | null }) => Promise<FolderItem>
      renameFolder: (input: { folderId: string; name: string }) => Promise<FolderItem | null>
      deleteFolder: (folderId: string) => Promise<boolean>
      listTags: () => Promise<TagItem[]>
      createTag: (input: { name: string; color?: string }) => Promise<TagItem>
      renameTag: (input: { tagId: string; name: string }) => Promise<TagItem | null>
      deleteTag: (tagId: string) => Promise<boolean>
      setPaperFolder: (input: { paperId: string; folderId: string | null }) => Promise<boolean>
      setPaperTags: (input: { paperId: string; tagIds: string[] }) => Promise<boolean>
      listNotes: (paperId: string | null) => Promise<NoteItem[]>
      createNote: (input: {
        paperId: string | null
        parentId?: string | null
        title: string
        isGroup: boolean
      }) => Promise<NoteItem>
      updateNote: (input: { id: string; title: string; content: string }) => Promise<NoteItem | null>
      getAiSettings: () => Promise<AiSettings>
      saveAiPreset: (input: {
        id?: string
        name: string
        apiKey: string
        baseUrl: string
        model: string
        provider: string
      }) => Promise<AiSettings>
      setActiveAiPreset: (id: string) => Promise<AiSettings>
      listConversations: () => Promise<ConversationSummary[]>
      createConversation: (input: { name?: string; paperIds: string[] }) => Promise<ConversationDetail>
      getConversation: (id: string) => Promise<ConversationDetail | null>
      renameConversation: (input: { conversationId: string; name: string }) => Promise<ConversationDetail | null>
      deleteConversation: (conversationId: string) => Promise<boolean>
      updateConversationPapers: (input: {
        conversationId: string
        paperIds: string[]
      }) => Promise<ConversationDetail | null>
      sendAiMessage: (input: { conversationId: string; content: string }) => Promise<ConversationDetail>
      exportConversation: (conversationId: string) => Promise<{ filePath: string } | null>
    }
  }
}

export {}
