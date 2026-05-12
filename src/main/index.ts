import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { createDatabase } from './services/database'
import { createLibraryService } from './services/library'
import { createWorkspaceService } from './services/workspace'
import { createAiService } from './services/ai'
import type { LibraryQuery } from '../shared/contracts'

let mainWindow: BrowserWindow | null = null

function ensureUserDataDir(): string {
  const dataDir = join(app.getPath('userData'), 'paperbox-data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1320,
    minHeight: 760,
    title: 'PaperBox Rebuild',
    backgroundColor: '#eef1f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

app.whenReady().then(() => {
  const dataDir = ensureUserDataDir()
  const database = createDatabase(join(dataDir, 'paperbox.db'))
  const libraryRoot = join(dataDir, 'library-files')
  const library = createLibraryService(database, { filesDir: libraryRoot })
  const workspace = createWorkspaceService(database)
  const ai = createAiService(database)

  ipcMain.handle('app:get-bootstrap', async () => ({
    appName: 'PaperBox Rebuild',
    dbPath: database.dbPath,
    libraryRoot
  }))

  ipcMain.handle('library:query-papers', async (_event, query: LibraryQuery) => library.queryPapers(query))
  ipcMain.handle('library:get-paper-detail', async (_event, id: string) => library.getPaperDetail(id))
  ipcMain.handle('library:import-papers', async () => library.importPapers())
  ipcMain.handle('library:save-ai-summary', async (_event, input: { paperId: string; summary: string }) =>
    library.saveAiSummary(input)
  )
  ipcMain.handle('library:rename-paper', async (_event, input: { paperId: string; title: string }) =>
    library.renamePaper(input)
  )
  ipcMain.handle('library:delete-paper', async (_event, paperId: string) => {
    const ok = library.deletePaper(paperId)
    if (ok) ai.removePaperIdFromAllConversations(paperId)
    return ok
  })

  ipcMain.handle('workspace:list-folders', async () => workspace.listFolders())
  ipcMain.handle('workspace:create-folder', async (_event, input: { name: string; parentId?: string | null }) =>
    workspace.createFolder(input)
  )
  ipcMain.handle('workspace:rename-folder', async (_event, input: { folderId: string; name: string }) =>
    workspace.renameFolder(input)
  )
  ipcMain.handle('workspace:delete-folder', async (_event, folderId: string) => workspace.deleteFolder(folderId))
  ipcMain.handle('workspace:list-tags', async () => workspace.listTags())
  ipcMain.handle('workspace:create-tag', async (_event, input: { name: string; color?: string }) =>
    workspace.createTag(input)
  )
  ipcMain.handle('workspace:rename-tag', async (_event, input: { tagId: string; name: string }) =>
    workspace.renameTag(input)
  )
  ipcMain.handle('workspace:delete-tag', async (_event, tagId: string) => workspace.deleteTag(tagId))
  ipcMain.handle('workspace:set-paper-folder', async (_event, input: { paperId: string; folderId: string | null }) => {
    workspace.setPaperFolder(input)
    return true
  })
  ipcMain.handle('workspace:set-paper-tags', async (_event, input: { paperId: string; tagIds: string[] }) => {
    workspace.setPaperTags(input)
    return true
  })
  ipcMain.handle('workspace:list-notes', async (_event, paperId: string | null) => workspace.listNotes(paperId))
  ipcMain.handle(
    'workspace:create-note',
    async (_event, input: { paperId: string | null; parentId?: string | null; title: string; isGroup: boolean }) =>
      workspace.createNote(input)
  )
  ipcMain.handle(
    'workspace:update-note',
    async (_event, input: { id: string; title: string; content: string }) => workspace.updateNote(input)
  )

  ipcMain.handle('ai:get-settings', async () => ai.getSettings())
  ipcMain.handle(
    'ai:save-preset',
    async (
      _event,
      input: { id?: string; name: string; apiKey: string; baseUrl: string; model: string; provider: string }
    ) => ai.savePreset(input)
  )
  ipcMain.handle('ai:set-active-preset', async (_event, id: string) => ai.setActivePreset(id))
  ipcMain.handle('ai:list-conversations', async () => ai.listConversations())
  ipcMain.handle('ai:create-conversation', async (_event, input: { name?: string; paperIds: string[] }) =>
    ai.createConversation(input)
  )
  ipcMain.handle('ai:get-conversation', async (_event, id: string) => ai.getConversation(id))
  ipcMain.handle('ai:rename-conversation', async (_event, input: { conversationId: string; name: string }) =>
    ai.renameConversation(input)
  )
  ipcMain.handle('ai:delete-conversation', async (_event, conversationId: string) => ai.deleteConversation(conversationId))
  ipcMain.handle('ai:update-conversation-papers', async (_event, input: { conversationId: string; paperIds: string[] }) =>
    ai.updateConversationPapers(input)
  )
  ipcMain.handle('ai:send-message', async (_event, input: { conversationId: string; content: string }) =>
    ai.sendMessage(input)
  )
  ipcMain.handle('ai:export-conversation', async (_event, conversationId: string) => ai.exportConversation(conversationId))

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
