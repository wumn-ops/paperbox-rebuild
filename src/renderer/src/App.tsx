import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Clock,
  LayoutGrid,
  MessageSquarePlus,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  Tag,
  FolderPlus,
  X
} from 'lucide-react'
import type {
  AiPreset,
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

type MainView = 'library' | 'settings'
type LibraryNav = 'all' | 'recent' | 'tags'

type SplitterKind = 'sidebar' | 'mainChat' | 'mainNotes' | 'chatNotes' | 'libraryList'

type LayoutWidths = {
  sidebarPx: number
  libraryListPx: number
  chatDockPx: number
  notesDockPx: number
}

const LAYOUT_STORAGE_KEY = 'paperbox-layout-widths-v1'

const LAYOUT_DEFAULTS: LayoutWidths = {
  sidebarPx: 252,
  libraryListPx: 300,
  chatDockPx: 308,
  notesDockPx: 328
}

const LAYOUT_MIN = { sidebar: 196, libraryList: 220, chat: 220, notes: 220 }
const LAYOUT_MAX = { sidebar: 520, libraryList: 640, chat: 680, notes: 680 }

function clampSize(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function loadLayoutWidths(): LayoutWidths {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return { ...LAYOUT_DEFAULTS }
    const p = JSON.parse(raw) as Partial<LayoutWidths>
    return {
      sidebarPx: clampSize(Number(p.sidebarPx) || LAYOUT_DEFAULTS.sidebarPx, LAYOUT_MIN.sidebar, LAYOUT_MAX.sidebar),
      libraryListPx: clampSize(
        Number(p.libraryListPx) || LAYOUT_DEFAULTS.libraryListPx,
        LAYOUT_MIN.libraryList,
        LAYOUT_MAX.libraryList
      ),
      chatDockPx: clampSize(Number(p.chatDockPx) || LAYOUT_DEFAULTS.chatDockPx, LAYOUT_MIN.chat, LAYOUT_MAX.chat),
      notesDockPx: clampSize(Number(p.notesDockPx) || LAYOUT_DEFAULTS.notesDockPx, LAYOUT_MIN.notes, LAYOUT_MAX.notes)
    }
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}

type AppContextMenuState =
  | { kind: 'conversation'; x: number; y: number; conversationId: string }
  | { kind: 'folder'; x: number; y: number; folderId: string }
  | { kind: 'tag'; x: number; y: number; tagId: string }
  | { kind: 'paper'; x: number; y: number; paperId: string }
  | { kind: 'noteGroup'; x: number; y: number; noteId: string }
  | { kind: 'noteItem'; x: number; y: number; noteId: string }

type RenameDialogState =
  | { kind: 'conversation'; conversationId: string; title: string }
  | { kind: 'folder'; folderId: string; title: string }
  | { kind: 'tag'; tagId: string; title: string }
  | { kind: 'paper'; paperId: string; title: string }
  | { kind: 'note'; noteId: string; title: string; isGroup: boolean }

type MoveNoteDialogState = { noteId: string; selectedParentId: string | null }

const RECENT_MS = 14 * 24 * 60 * 60 * 1000
const CONV_MENU_W = 168
const CONV_MENU_H = 88
const NOTE_GROUP_MENU_W = 176
const NOTE_GROUP_MENU_H = 124
const NOTE_ITEM_MENU_W = 184
const NOTE_ITEM_MENU_H = 168

function clampConvMenuPosition(
  x: number,
  y: number,
  menu: { w: number; h: number } = { w: CONV_MENU_W, h: CONV_MENU_H }
): { x: number; y: number } {
  const pad = 8
  let nx = x
  let ny = y
  if (nx + menu.w > window.innerWidth - pad) nx = window.innerWidth - menu.w - pad
  if (ny + menu.h > window.innerHeight - pad) ny = window.innerHeight - menu.h - pad
  if (nx < pad) nx = pad
  if (ny < pad) ny = pad
  return { x: nx, y: ny }
}

const fileTypeOptions = [
  { label: '全部类型', value: 'all' },
  { label: 'PDF', value: 'pdf' },
  { label: 'TXT', value: 'txt' },
  { label: 'Markdown', value: 'md' },
  { label: 'DOCX', value: 'docx' },
  { label: 'XLSX', value: 'xlsx' },
  { label: 'CSV', value: 'csv' }
]

const emptyAiSettings: AiSettings = {
  activePresetId: '',
  presets: []
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function formatFileSize(size: number | null): string {
  if (!size) return '未知'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function summarizeImportResult(result: ImportPapersResult): string {
  if (result.canceled) return '已取消导入'
  const parts: string[] = []
  if (result.imported.length > 0) parts.push(`已导入 ${result.imported.length} 个文件`)
  if (result.skipped.length > 0) parts.push(`已跳过 ${result.skipped.length} 个文件`)
  return parts.join('，') || '没有导入任何文件'
}

function buildNoteDepthMap(notes: NoteItem[]): Map<string, number> {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const result = new Map<string, number>()

  const getDepth = (note: NoteItem): number => {
    if (!note.parentId) return 0
    const cached = result.get(note.id)
    if (cached !== undefined) return cached
    const parent = byId.get(note.parentId)
    return parent ? getDepth(parent) + 1 : 0
  }

  for (const note of notes) {
    result.set(note.id, getDepth(note))
  }

  return result
}

function collectSubtreeIds(notes: NoteItem[], rootId: string): Set<string> {
  const childrenByParent = new Map<string | null, string[]>()
  for (const n of notes) {
    const p = n.parentId
    if (!childrenByParent.has(p)) childrenByParent.set(p, [])
    childrenByParent.get(p)!.push(n.id)
  }
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    for (const c of childrenByParent.get(id) ?? []) {
      stack.push(c)
    }
  }
  return out
}

function defaultPresetDraft(): AiPreset {
  return {
    id: '',
    name: '',
    apiKey: '',
    baseUrl: '',
    model: '',
    provider: '',
    isBuiltin: false,
    createdAt: 0
  }
}

export function App() {
  const [mainView, setMainView] = useState<MainView>('library')
  const [libraryNav, setLibraryNav] = useState<LibraryNav>('all')
  const [chatPaneOpen, setChatPaneOpen] = useState(true)
  const [notebookPaneOpen, setNotebookPaneOpen] = useState(true)

  const tagsSectionRef = useRef<HTMLElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const renameTitleInputRef = useRef<HTMLInputElement | null>(null)
  const renameDialogFocusKeyRef = useRef<string | null>(null)
  const layoutDragRef = useRef<{ kind: SplitterKind; lastX: number } | null>(null)

  const [layoutWidths, setLayoutWidths] = useState<LayoutWidths>(loadLayoutWidths)

  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null)
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null)
  const [selectedPaper, setSelectedPaper] = useState<PaperDetail | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [selectedTagId, setSelectedTagId] = useState('all')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editingNoteTitle, setEditingNoteTitle] = useState('')
  const [editingNoteContent, setEditingNoteContent] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [isCreatingNoteGroup, setIsCreatingNoteGroup] = useState(false)
  const [newNoteGroupTitle, setNewNoteGroupTitle] = useState('')
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [fileTypeFilter, setFileTypeFilter] = useState('all')
  const [paperDetailOpen, setPaperDetailOpen] = useState(false)
  /** 文献列表勾选：加入会话上下文（可多选） */
  const [contextPaperSelection, setContextPaperSelection] = useState(() => new Set<string>())
  const paperListSelectAllRef = useRef<HTMLInputElement | null>(null)
  /** 笔记（非分组）勾选：加入对话上下文 */
  const [contextNoteSelection, setContextNoteSelection] = useState(() => new Set<string>())
  const noteListSelectAllRef = useRef<HTMLInputElement | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [aiSettings, setAiSettings] = useState<AiSettings>(emptyAiSettings)
  const [presetDraft, setPresetDraft] = useState<AiPreset>(defaultPresetDraft())
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isSavingSummary, setIsSavingSummary] = useState(false)
  const [isExportingConversation, setIsExportingConversation] = useState(false)
  const [contextMenu, setContextMenu] = useState<AppContextMenuState | null>(null)
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null)
  const [moveNoteDialog, setMoveNoteDialog] = useState<MoveNoteDialogState | null>(null)

  const deferredKeyword = useDeferredValue(searchTerm)
  const activeQuery = useMemo<LibraryQuery>(
    () => ({
      keyword: deferredKeyword,
      fileType: fileTypeFilter,
      folderId: selectedFolderId,
      tagId: selectedTagId
    }),
    [deferredKeyword, fileTypeFilter, selectedFolderId, selectedTagId]
  )

  const displayedPapers = useMemo(() => {
    if (libraryNav !== 'recent') return papers
    const cutoff = Date.now() - RECENT_MS
    return papers.filter((p) => p.updatedAt >= cutoff)
  }, [papers, libraryNav])

  const displayedPaperIds = useMemo(() => displayedPapers.map((p) => p.id), [displayedPapers])

  const contextSelectStats = useMemo(() => {
    let selectedOnPage = 0
    for (const id of displayedPaperIds) {
      if (contextPaperSelection.has(id)) selectedOnPage += 1
    }
    const allDisplayedSelected =
      displayedPaperIds.length > 0 && selectedOnPage === displayedPaperIds.length
    const someDisplayedSelected = selectedOnPage > 0 && !allDisplayedSelected
    return { selectedOnPage, allDisplayedSelected, someDisplayedSelected, contextSelectionCount: contextPaperSelection.size }
  }, [displayedPaperIds, contextPaperSelection])

  const noteContextSelectStats = useMemo(() => {
    const selectableIds = notes.filter((n) => !n.isGroup).map((n) => n.id)
    const idSet = new Set(selectableIds)
    let selectedInScope = 0
    for (const id of contextNoteSelection) {
      if (idSet.has(id)) selectedInScope += 1
    }
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => contextNoteSelection.has(id))
    const someSelected = selectedInScope > 0 && !allSelected
    return {
      selectableCount: selectableIds.length,
      selectedInScope,
      allSelected,
      someSelected
    }
  }, [notes, contextNoteSelection])

  useEffect(() => {
    const visible = new Set(displayedPapers.map((p) => p.id))
    setContextPaperSelection((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
      }
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev
      return next
    })
  }, [displayedPapers])

  useEffect(() => {
    const el = paperListSelectAllRef.current
    if (el) el.indeterminate = contextSelectStats.someDisplayedSelected
  }, [contextSelectStats.someDisplayedSelected, displayedPaperIds.length])

  useEffect(() => {
    const valid = new Set(notes.filter((n) => !n.isGroup).map((n) => n.id))
    setContextNoteSelection((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (valid.has(id)) next.add(id)
      }
      if (next.size === prev.size && [...prev].every((id) => next.has(id))) return prev
      return next
    })
  }, [notes])

  useEffect(() => {
    const el = noteListSelectAllRef.current
    if (el) el.indeterminate = noteContextSelectStats.someSelected
  }, [noteContextSelectStats.someSelected, noteContextSelectStats.selectableCount])

  const activeNote = useMemo(() => notes.find((note) => note.id === selectedNoteId) ?? null, [notes, selectedNoteId])
  const noteDepthMap = useMemo(() => buildNoteDepthMap(notes), [notes])
  const moveNoteGroupOptions = useMemo(() => {
    if (!moveNoteDialog) return [] as NoteItem[]
    const blocked = collectSubtreeIds(notes, moveNoteDialog.noteId)
    return notes.filter((n) => n.isGroup && !blocked.has(n.id))
  }, [moveNoteDialog, notes])
  const activePreset = useMemo(
    () => aiSettings.presets.find((preset) => preset.id === aiSettings.activePresetId) ?? null,
    [aiSettings]
  )

  const selectedPaperTitleHint = useMemo(
    () => selectedPaper?.title ?? papers.find((p) => p.id === selectedPaperId)?.title ?? null,
    [selectedPaper, papers, selectedPaperId]
  )

  useEffect(() => {
    if (libraryNav !== 'recent') return
    if (!selectedPaperId) return
    if (!displayedPapers.some((p) => p.id === selectedPaperId)) {
      setSelectedPaperId(null)
      setPaperDetailOpen(false)
    }
  }, [libraryNav, displayedPapers, selectedPaperId])

  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [contextMenu])

  useEffect(() => {
    if (!renameDialog) {
      renameDialogFocusKeyRef.current = null
      return
    }
    const key =
      renameDialog.kind === 'conversation'
        ? `c:${renameDialog.conversationId}`
        : renameDialog.kind === 'folder'
          ? `f:${renameDialog.folderId}`
          : renameDialog.kind === 'tag'
            ? `t:${renameDialog.tagId}`
            : renameDialog.kind === 'note'
              ? `n:${renameDialog.noteId}`
              : `p:${renameDialog.paperId}`
    const isFirstOpen = renameDialogFocusKeyRef.current !== key
    renameDialogFocusKeyRef.current = key
    if (isFirstOpen) {
      requestAnimationFrame(() => {
        renameTitleInputRef.current?.focus()
        renameTitleInputRef.current?.select()
      })
    }
  }, [renameDialog])

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutWidths))
    } catch {
      /* ignore quota / private mode */
    }
  }, [layoutWidths])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = layoutDragRef.current
      if (!d) return
      const dx = e.clientX - d.lastX
      d.lastX = e.clientX
      setLayoutWidths((w) => {
        switch (d!.kind) {
          case 'sidebar':
            return { ...w, sidebarPx: clampSize(w.sidebarPx + dx, LAYOUT_MIN.sidebar, LAYOUT_MAX.sidebar) }
          case 'mainChat':
            return { ...w, chatDockPx: clampSize(w.chatDockPx - dx, LAYOUT_MIN.chat, LAYOUT_MAX.chat) }
          case 'mainNotes':
            return { ...w, notesDockPx: clampSize(w.notesDockPx - dx, LAYOUT_MIN.notes, LAYOUT_MAX.notes) }
          case 'chatNotes': {
            return {
              ...w,
              notesDockPx: clampSize(w.notesDockPx - dx, LAYOUT_MIN.notes, LAYOUT_MAX.notes),
              chatDockPx: clampSize(w.chatDockPx + dx, LAYOUT_MIN.chat, LAYOUT_MAX.chat)
            }
          }
          case 'libraryList':
            return {
              ...w,
              libraryListPx: clampSize(w.libraryListPx + dx, LAYOUT_MIN.libraryList, LAYOUT_MAX.libraryList)
            }
          default:
            return w
        }
      })
    }
    const onUp = () => {
      layoutDragRef.current = null
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  function beginLayoutDrag(kind: SplitterKind, e: React.MouseEvent) {
    e.preventDefault()
    layoutDragRef.current = { kind, lastX: e.clientX }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  async function loadWorkspaceChrome() {
    try {
      const [nextFolders, nextTags] = await Promise.all([window.paperbox.listFolders(), window.paperbox.listTags()])
      setFolders(nextFolders)
      setTags(nextTags)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载文件夹与标签失败')
    }
  }

  async function loadAiChrome() {
    try {
      const [nextSettings, nextConversations] = await Promise.all([
        window.paperbox.getAiSettings(),
        window.paperbox.listConversations()
      ])
      setAiSettings(nextSettings)
      setConversations(nextConversations)
      if (!presetDraft.id && nextSettings.presets.length > 0) {
        const preset =
          nextSettings.presets.find((item) => item.id === nextSettings.activePresetId) ?? nextSettings.presets[0]
        setPresetDraft(preset)
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载 AI 设置失败')
    }
  }

  async function loadLibrary(query: LibraryQuery, nextSelectedPaperId?: string | null) {
    setIsLoadingList(true)
    try {
      const nextPapers = await window.paperbox.queryPapers(query)
      setPapers(nextPapers)
      setSelectedPaperId((prev) => {
        if (nextSelectedPaperId !== undefined) {
          return nextSelectedPaperId && nextPapers.some((paper) => paper.id === nextSelectedPaperId)
            ? nextSelectedPaperId
            : null
        }
        if (prev !== null && nextPapers.some((paper) => paper.id === prev)) {
          return prev
        }
        return null
      })
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载文献列表失败')
    } finally {
      setIsLoadingList(false)
    }
  }

  async function loadNotes(paperId: string | null, preferredNoteId?: string | null) {
    try {
      const nextNotes = await window.paperbox.listNotes(paperId)
      setNotes(nextNotes)
      setSelectedNoteId((prev) => {
        if (preferredNoteId && nextNotes.some((note) => note.id === preferredNoteId)) {
          return preferredNoteId
        }
        if (prev && nextNotes.some((note) => note.id === prev)) {
          return prev
        }
        return nextNotes[0]?.id ?? null
      })
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载笔记失败')
    }
  }

  async function loadConversation(conversationId: string | null) {
    if (!conversationId) {
      setConversationDetail(null)
      return
    }
    try {
      const detail = await window.paperbox.getConversation(conversationId)
      setConversationDetail(detail)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载对话失败')
    }
  }

  useEffect(() => {
    window.paperbox
      .getBootstrap()
      .then(setBootstrap)
      .catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : '初始化失败')
      })

    void Promise.all([loadWorkspaceChrome(), loadAiChrome()])
  }, [])

  useEffect(() => {
    void loadLibrary(activeQuery)
  }, [activeQuery])

  useEffect(() => {
    if (!selectedPaperId) {
      setSelectedPaper(null)
      void loadNotes(null)
      return
    }

    void loadNotes(selectedPaperId, selectedNoteId)

    if (!paperDetailOpen) {
      setSelectedPaper(null)
      setIsLoadingDetail(false)
      return
    }

    setIsLoadingDetail(true)
    window.paperbox
      .getPaperDetail(selectedPaperId)
      .then((paper) => {
        setSelectedPaper(paper)
      })
      .catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : '加载文献详情失败')
      })
      .finally(() => {
        setIsLoadingDetail(false)
      })
  }, [selectedPaperId, paperDetailOpen])

  useEffect(() => {
    setEditingNoteTitle(activeNote?.title ?? '')
    setEditingNoteContent(activeNote?.content ?? '')
  }, [activeNote?.id])

  useEffect(() => {
    void loadConversation(selectedConversationId)
  }, [selectedConversationId])

  function goAllPapers() {
    setMainView('library')
    setLibraryNav('all')
    setSelectedFolderId('all')
    setSelectedTagId('all')
  }

  function goRecent() {
    setMainView('library')
    setLibraryNav('recent')
  }

  function goTagsInSidebar() {
    setMainView('library')
    setLibraryNav('tags')
    requestAnimationFrame(() => {
      tagsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  async function handleImport() {
    setIsImporting(true)
    try {
      const result = await window.paperbox.importPapers()
      setStatusMessage(summarizeImportResult(result))
      if (!result.canceled) {
        const importedPaperId = result.imported[0]?.id ?? null
        await loadLibrary(activeQuery, importedPaperId)
        if (importedPaperId) {
          setPaperDetailOpen(true)
        }
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim()
    if (!name) return
    await window.paperbox.createFolder({ name })
    await loadWorkspaceChrome()
    setNewFolderName('')
    setIsCreatingFolder(false)
    setStatusMessage(`已创建文件夹：${name}`)
  }

  async function handleCreateTag() {
    const name = newTagName.trim()
    if (!name) return
    await window.paperbox.createTag({ name })
    await loadWorkspaceChrome()
    setNewTagName('')
    setIsCreatingTag(false)
    setStatusMessage(`已创建标签：${name}`)
  }

  async function handleAssignFolder(folderId: string) {
    if (!selectedPaperId) return
    await window.paperbox.setPaperFolder({
      paperId: selectedPaperId,
      folderId: folderId === 'none' ? null : folderId
    })
    await Promise.all([
      loadWorkspaceChrome(),
      loadLibrary(activeQuery, selectedPaperId),
      ...(paperDetailOpen ? [window.paperbox.getPaperDetail(selectedPaperId).then(setSelectedPaper)] : [])
    ])
    setStatusMessage('已更新文件夹')
  }

  async function handleToggleTag(tagId: string) {
    if (!selectedPaperId || !selectedPaper) return
    const currentTagIds = new Set(selectedPaper.tagIds.map((tag) => tag.id))
    if (currentTagIds.has(tagId)) currentTagIds.delete(tagId)
    else currentTagIds.add(tagId)

    await window.paperbox.setPaperTags({
      paperId: selectedPaperId,
      tagIds: [...currentTagIds]
    })

    await Promise.all([
      loadWorkspaceChrome(),
      loadLibrary(activeQuery, selectedPaperId),
      ...(paperDetailOpen ? [window.paperbox.getPaperDetail(selectedPaperId).then(setSelectedPaper)] : [])
    ])
    setStatusMessage('已更新标签')
  }

  async function handleCreateNote(isGroup: boolean) {
    const title = isGroup ? newNoteGroupTitle.trim() : newNoteTitle.trim()
    if (!title) return

    const preferredParentId = !isGroup && activeNote?.isGroup ? activeNote.id : null
    const note = await window.paperbox.createNote({
      paperId: selectedPaperId,
      parentId: preferredParentId,
      title,
      isGroup
    })

    await loadNotes(selectedPaperId, note.id)
    if (isGroup) {
      setNewNoteGroupTitle('')
      setIsCreatingNoteGroup(false)
    } else {
      setNewNoteTitle('')
      setIsCreatingNote(false)
    }
    setStatusMessage(isGroup ? '已创建笔记分组' : '已创建笔记')
  }

  async function handleSaveNote() {
    if (!selectedNoteId) return
    const result = await window.paperbox.updateNote({
      id: selectedNoteId,
      title: editingNoteTitle.trim() || '未命名笔记',
      content: editingNoteContent
    })
    if (result) {
      await loadNotes(selectedPaperId, result.id)
      setStatusMessage('笔记已保存')
    }
  }

  function toggleContextPaperInSelection(paperId: string) {
    setContextPaperSelection((prev) => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  function toggleSelectAllDisplayedPapersForContext() {
    setContextPaperSelection((prev) => {
      const ids = displayedPapers.map((p) => p.id)
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      if (allSelected) {
        for (const id of ids) next.delete(id)
      } else {
        for (const id of ids) next.add(id)
      }
      return next
    })
  }

  function clearContextPaperSelection() {
    setContextPaperSelection(new Set())
  }

  function toggleContextNoteSelection(noteId: string) {
    setContextNoteSelection((prev) => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }

  function toggleSelectAllNotesForContext() {
    const selectableIds = notes.filter((n) => !n.isGroup).map((n) => n.id)
    const allOn = selectableIds.length > 0 && selectableIds.every((id) => contextNoteSelection.has(id))
    setContextNoteSelection(() => (allOn ? new Set() : new Set(selectableIds)))
  }

  function paperIdsForConversationContext(): string[] {
    if (contextPaperSelection.size > 0) return Array.from(contextPaperSelection)
    if (selectedPaperId) return [selectedPaperId]
    return []
  }

  async function handleCreateConversationFromSelectedPaper() {
    const paperIds = paperIdsForConversationContext()
    const noteIds = notes.filter((n) => !n.isGroup && contextNoteSelection.has(n.id)).map((n) => n.id)
    let name = '新对话'
    if (paperIds.length === 1 && noteIds.length === 0) {
      const title =
        papers.find((p) => p.id === paperIds[0])?.title ??
        displayedPapers.find((p) => p.id === paperIds[0])?.title ??
        selectedPaperTitleHint
      name = title ? `对话：${title}` : '新对话'
    } else if (paperIds.length > 1 && noteIds.length === 0) {
      name = `对话：${paperIds.length} 篇文献`
    } else if (paperIds.length === 0 && noteIds.length === 1) {
      const t = notes.find((n) => n.id === noteIds[0])?.title
      name = t ? `对话：${t}` : '新对话'
    } else if (paperIds.length === 0 && noteIds.length > 1) {
      name = `对话：${noteIds.length} 条笔记`
    } else if (paperIds.length > 0 && noteIds.length > 0) {
      name = `对话：${paperIds.length} 篇文献 · ${noteIds.length} 笔记`
    }
    const detail = await window.paperbox.createConversation({
      paperIds,
      noteIds,
      name
    })
    await loadAiChrome()
    setSelectedConversationId(detail.conversation.id)
    setChatPaneOpen(true)
    const parts: string[] = []
    if (paperIds.length > 0) parts.push(`${paperIds.length} 篇文献`)
    if (noteIds.length > 0) parts.push(`${noteIds.length} 条笔记`)
    setStatusMessage(parts.length > 0 ? `已创建对话（${parts.join('，')}）` : '已创建对话')
  }

  async function handleNewEmptyConversation() {
    const detail = await window.paperbox.createConversation({
      paperIds: [],
      noteIds: [],
      name: '新对话'
    })
    await loadAiChrome()
    setSelectedConversationId(detail.conversation.id)
    setChatPaneOpen(true)
    setStatusMessage('已创建对话')
  }

  function handleConversationContextMenu(event: React.MouseEvent, conversationId: string) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = clampConvMenuPosition(event.clientX, event.clientY)
    setContextMenu({ kind: 'conversation', x, y, conversationId })
  }

  function handleFolderContextMenu(event: React.MouseEvent, folderId: string) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = clampConvMenuPosition(event.clientX, event.clientY)
    setContextMenu({ kind: 'folder', x, y, folderId })
  }

  function handleTagContextMenu(event: React.MouseEvent, tagId: string) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = clampConvMenuPosition(event.clientX, event.clientY)
    setContextMenu({ kind: 'tag', x, y, tagId })
  }

  function handlePaperContextMenu(event: React.MouseEvent, paperId: string) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = clampConvMenuPosition(event.clientX, event.clientY)
    setContextMenu({ kind: 'paper', x, y, paperId })
  }

  function handleNoteContextMenu(event: React.MouseEvent, note: NoteItem) {
    event.preventDefault()
    event.stopPropagation()
    if (note.isGroup) {
      const { x, y } = clampConvMenuPosition(event.clientX, event.clientY, {
        w: NOTE_GROUP_MENU_W,
        h: NOTE_GROUP_MENU_H
      })
      setContextMenu({ kind: 'noteGroup', x, y, noteId: note.id })
    } else {
      const { x, y } = clampConvMenuPosition(event.clientX, event.clientY, {
        w: NOTE_ITEM_MENU_W,
        h: NOTE_ITEM_MENU_H
      })
      setContextMenu({ kind: 'noteItem', x, y, noteId: note.id })
    }
  }

  function openRenameConversation(conversationId: string) {
    const conv = conversations.find((c) => c.id === conversationId)
    setContextMenu(null)
    setRenameDialog({ kind: 'conversation', conversationId, title: conv?.name ?? '' })
  }

  function openRenameFolder(folderId: string) {
    const folder = folders.find((f) => f.id === folderId)
    setContextMenu(null)
    setRenameDialog({ kind: 'folder', folderId, title: folder?.name ?? '' })
  }

  function openRenameTag(tagId: string) {
    const tag = tags.find((t) => t.id === tagId)
    setContextMenu(null)
    setRenameDialog({ kind: 'tag', tagId, title: tag?.name ?? '' })
  }

  function openRenamePaper(paperId: string) {
    const paper =
      displayedPapers.find((p) => p.id === paperId) ?? papers.find((p) => p.id === paperId)
    setContextMenu(null)
    setRenameDialog({ kind: 'paper', paperId, title: paper?.title ?? '' })
  }

  function openRenameNote(noteId: string) {
    const note = notes.find((n) => n.id === noteId)
    setContextMenu(null)
    setRenameDialog({ kind: 'note', noteId, title: note?.title ?? '', isGroup: note?.isGroup ?? false })
  }

  function openMoveNoteDialog(noteId: string) {
    setContextMenu(null)
    const note = notes.find((n) => n.id === noteId)
    const blocked = collectSubtreeIds(notes, noteId)
    let parent = note?.parentId ?? null
    if (parent !== null) {
      const ok = notes.some((n) => n.isGroup && n.id === parent && !blocked.has(n.id))
      if (!ok) parent = null
    }
    setMoveNoteDialog({ noteId, selectedParentId: parent })
  }

  async function handleConfirmMoveNote() {
    if (!moveNoteDialog) return
    try {
      const updated = await window.paperbox.setNoteParent({
        noteId: moveNoteDialog.noteId,
        parentId: moveNoteDialog.selectedParentId
      })
      if (!updated) {
        setStatusMessage('无法移动到所选分组（目标无效或会形成循环）')
        return
      }
      setMoveNoteDialog(null)
      await loadNotes(selectedPaperId, updated.id)
      setStatusMessage('已移动笔记')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '移动失败')
    }
  }

  async function handleDeleteNoteEntry(noteId: string) {
    const note = notes.find((n) => n.id === noteId)
    const hasChildren = notes.some((n) => n.parentId === noteId)
    let message: string
    if (note?.isGroup || hasChildren) {
      message = note
        ? `确定删除「${note.title}」及其中的全部子笔记？此操作不可恢复。`
        : '确定删除该项及其中的全部子笔记？此操作不可恢复。'
    } else {
      message = note ? `确定删除笔记「${note.title}」？此操作不可恢复。` : '确定删除该笔记？此操作不可恢复。'
    }
    const ok = window.confirm(message)
    if (!ok) return
    setContextMenu(null)
    try {
      const deleted = await window.paperbox.deleteNote(noteId)
      if (!deleted) {
        setStatusMessage('未找到该笔记')
        await loadNotes(selectedPaperId)
        return
      }
      await loadNotes(selectedPaperId)
      setStatusMessage(note?.isGroup || hasChildren ? '已删除（含子笔记）' : '已删除笔记')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleAddNoteUnderGroup(groupId: string) {
    setContextMenu(null)
    try {
      const note = await window.paperbox.createNote({
        paperId: selectedPaperId,
        parentId: groupId,
        title: '未命名笔记',
        isGroup: false
      })
      await loadNotes(selectedPaperId, note.id)
      setStatusMessage('已在分组下添加笔记')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '添加笔记失败')
    }
  }

  async function handleConfirmRename() {
    if (!renameDialog) return
    const title = renameDialog.title.trim()
    if (!title) {
      setStatusMessage('名称不能为空')
      return
    }
    try {
      if (renameDialog.kind === 'conversation') {
        const conversationId = renameDialog.conversationId
        const detail = await window.paperbox.renameConversation({ conversationId, name: title })
        setRenameDialog(null)
        await loadAiChrome()
        if (detail && selectedConversationId === conversationId) {
          setConversationDetail(detail)
        }
        setStatusMessage('已重命名会话')
        return
      }
      if (renameDialog.kind === 'folder') {
        const folderId = renameDialog.folderId
        const updated = await window.paperbox.renameFolder({ folderId, name: title })
        setRenameDialog(null)
        if (!updated) {
          setStatusMessage('未找到该文件夹')
          await loadWorkspaceChrome()
          return
        }
        await loadWorkspaceChrome()
        if (selectedPaperId) {
          const detail = await window.paperbox.getPaperDetail(selectedPaperId)
          setSelectedPaper(detail)
        }
        setStatusMessage('已重命名文件夹')
        return
      }
      if (renameDialog.kind === 'tag') {
        const tagId = renameDialog.tagId
        const updated = await window.paperbox.renameTag({ tagId, name: title })
        setRenameDialog(null)
        if (!updated) {
          setStatusMessage('未找到该标签')
          await loadWorkspaceChrome()
          return
        }
        await loadWorkspaceChrome()
        if (selectedPaperId) {
          const detail = await window.paperbox.getPaperDetail(selectedPaperId)
          setSelectedPaper(detail)
        }
        setStatusMessage('已重命名标签')
        return
      }
      if (renameDialog.kind === 'note') {
        const noteId = renameDialog.noteId
        const existing = notes.find((n) => n.id === noteId)
        const updated = await window.paperbox.updateNote({
          id: noteId,
          title,
          content: existing?.content ?? ''
        })
        setRenameDialog(null)
        if (!updated) {
          setStatusMessage('未找到该笔记')
          await loadNotes(selectedPaperId)
          return
        }
        await loadNotes(selectedPaperId, updated.id)
        setStatusMessage(renameDialog.isGroup ? '已重命名分组' : '已重命名笔记')
        return
      }
      const paperId = renameDialog.paperId
      const updatedPaper = await window.paperbox.renamePaper({ paperId, title })
      setRenameDialog(null)
      if (!updatedPaper) {
        setStatusMessage('未找到该文献')
        await loadLibrary(activeQuery)
        return
      }
      await loadLibrary(activeQuery)
      if (selectedPaperId === paperId) {
        setSelectedPaper(updatedPaper)
      }
      setStatusMessage('已重命名文献')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '重命名失败')
    }
  }

  async function handleDeleteConversationById(conversationId: string) {
    const conv = conversations.find((c) => c.id === conversationId)
    const ok = window.confirm(
      conv ? `确定删除会话「${conv.name}」？将同时删除其中的所有消息。` : '确定删除该会话？'
    )
    if (!ok) return
    setContextMenu(null)
    try {
      const deleted = await window.paperbox.deleteConversation(conversationId)
      if (!deleted) {
        setStatusMessage('未找到该会话')
        await loadAiChrome()
        return
      }
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null)
        setConversationDetail(null)
      }
      await loadAiChrome()
      setStatusMessage('已删除会话')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleDeleteFolderById(folderId: string) {
    const folder = folders.find((f) => f.id === folderId)
    const ok = window.confirm(
      folder
        ? `确定删除文件夹「${folder.name}」？其中的子文件夹将被一并删除，文献将不再归属该文件夹。`
        : '确定删除该文件夹？'
    )
    if (!ok) return
    setContextMenu(null)
    try {
      const deleted = await window.paperbox.deleteFolder(folderId)
      if (!deleted) {
        setStatusMessage('未找到该文件夹')
        await loadWorkspaceChrome()
        return
      }
      if (selectedFolderId === folderId) setSelectedFolderId('all')
      await loadWorkspaceChrome()
      const nextQuery: LibraryQuery = {
        ...activeQuery,
        folderId: selectedFolderId === folderId ? 'all' : selectedFolderId,
        tagId: selectedTagId
      }
      await loadLibrary(nextQuery)
      if (selectedPaperId) {
        const detail = await window.paperbox.getPaperDetail(selectedPaperId)
        setSelectedPaper(detail)
      }
      setStatusMessage('已删除文件夹')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleDeleteTagById(tagId: string) {
    const tag = tags.find((t) => t.id === tagId)
    const ok = window.confirm(
      tag ? `确定删除标签「${tag.name}」？文献上将移除此标签。` : '确定删除该标签？'
    )
    if (!ok) return
    setContextMenu(null)
    try {
      const deleted = await window.paperbox.deleteTag(tagId)
      if (!deleted) {
        setStatusMessage('未找到该标签')
        await loadWorkspaceChrome()
        return
      }
      if (selectedTagId === tagId) setSelectedTagId('all')
      await loadWorkspaceChrome()
      const nextQuery: LibraryQuery = {
        ...activeQuery,
        tagId: selectedTagId === tagId ? 'all' : selectedTagId,
        folderId: selectedFolderId
      }
      await loadLibrary(nextQuery)
      if (selectedPaperId) {
        const detail = await window.paperbox.getPaperDetail(selectedPaperId)
        setSelectedPaper(detail)
      }
      setStatusMessage('已删除标签')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleDeletePaperById(paperId: string) {
    const paper = displayedPapers.find((p) => p.id === paperId) ?? papers.find((p) => p.id === paperId)
    const ok = window.confirm(
      paper
        ? `确定删除文献「${paper.title}」？将删除库内文件与关联数据，且无法恢复。`
        : '确定删除该文献？'
    )
    if (!ok) return
    setContextMenu(null)
    try {
      const deleted = await window.paperbox.deletePaper(paperId)
      if (!deleted) {
        setStatusMessage('未找到该文献')
        await loadLibrary(activeQuery)
        return
      }
      setContextPaperSelection((prev) => {
        const next = new Set(prev)
        next.delete(paperId)
        return next
      })
      if (selectedPaperId === paperId) {
        setSelectedPaperId(null)
        setSelectedPaper(null)
        setPaperDetailOpen(false)
      }
      await loadLibrary(activeQuery)
      await loadAiChrome()
      if (selectedConversationId) {
        const detail = await window.paperbox.getConversation(selectedConversationId)
        setConversationDetail(detail)
      }
      setStatusMessage('已删除文献')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleAddPapersToConversation() {
    if (!selectedConversationId) return
    const paperIds = paperIdsForConversationContext()
    if (paperIds.length === 0) return
    const next = await window.paperbox.updateConversationPapers({
      conversationId: selectedConversationId,
      paperIds
    })
    if (next) {
      setConversationDetail(next)
      await loadAiChrome()
      setStatusMessage(
        paperIds.length > 1 ? `已将 ${paperIds.length} 篇文献设为会话上下文` : '已将会话上下文设为当前文献'
      )
    }
  }

  async function handleAddNotesToConversation() {
    if (!selectedConversationId) return
    const noteIds = notes.filter((n) => !n.isGroup && contextNoteSelection.has(n.id)).map((n) => n.id)
    if (noteIds.length === 0) return
    const next = await window.paperbox.updateConversationNotes({
      conversationId: selectedConversationId,
      noteIds
    })
    if (next) {
      setConversationDetail(next)
      await loadAiChrome()
      setStatusMessage(
        noteIds.length > 1 ? `已将 ${noteIds.length} 条笔记设为会话上下文` : '已将所选笔记设为会话上下文'
      )
    }
  }

  async function handleSendMessage() {
    if (!selectedConversationId || !chatInput.trim()) return
    setIsSendingMessage(true)
    try {
      const nextDetail = await window.paperbox.sendAiMessage({
        conversationId: selectedConversationId,
        content: chatInput.trim()
      })
      setConversationDetail(nextDetail)
      setChatInput('')
      await loadAiChrome()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '发送失败')
    } finally {
      setIsSendingMessage(false)
    }
  }

  async function handleSaveSummaryToPaper() {
    if (!selectedPaperId || !conversationDetail) return
    const assistantMessages = [...conversationDetail.messages].reverse().filter((message) => message.role === 'assistant')
    const latestAssistantMessage = assistantMessages[0]
    if (!latestAssistantMessage) {
      setStatusMessage('暂无可保存的助手回复')
      return
    }

    setIsSavingSummary(true)
    try {
      const updatedPaper = await window.paperbox.saveAiSummary({
        paperId: selectedPaperId,
        summary: latestAssistantMessage.content
      })
      if (updatedPaper) {
        setSelectedPaper(updatedPaper)
        setStatusMessage('已将最新助手回复写入文献 AI 摘要')
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存摘要失败')
    } finally {
      setIsSavingSummary(false)
    }
  }

  async function handleExportConversation() {
    if (!selectedConversationId) return
    setIsExportingConversation(true)
    try {
      const result = await window.paperbox.exportConversation(selectedConversationId)
      if (result) {
        setStatusMessage(`已导出到 ${result.filePath}`)
      } else {
        setStatusMessage('已取消导出')
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导出失败')
    } finally {
      setIsExportingConversation(false)
    }
  }

  async function handleSavePreset() {
    const nextSettings = await window.paperbox.saveAiPreset({
      id: presetDraft.isBuiltin ? presetDraft.id : presetDraft.id || undefined,
      name: presetDraft.name,
      apiKey: presetDraft.apiKey,
      baseUrl: presetDraft.baseUrl,
      model: presetDraft.model,
      provider: presetDraft.provider
    })
    setAiSettings(nextSettings)
    await loadAiChrome()
    setStatusMessage('预设已保存')
  }

  async function handleSelectActivePreset(id: string) {
    const nextSettings = await window.paperbox.setActiveAiPreset(id)
    setAiSettings(nextSettings)
    const preset = nextSettings.presets.find((item) => item.id === id)
    if (preset) {
      setPresetDraft(preset)
    }
    setStatusMessage('已切换激活预设')
  }

  function handleTestConnection() {
    if (!activePreset) {
      setStatusMessage('请先选择或添加模型预设')
      return
    }
    setStatusMessage(`当前预设「${activePreset.name}」已就绪，请在右侧对话中发送一条消息以验证连接。`)
  }

  const librarySubtitle = useMemo(() => {
    if (libraryNav === 'recent') {
      return `显示最近 14 天内更新：${displayedPapers.length} 篇`
    }
    if (searchTerm.trim()) return `找到 ${displayedPapers.length} 条结果`
    return `共 ${displayedPapers.length} 篇文献`
  }, [displayedPapers.length, libraryNav, searchTerm])

  function renderLibraryMain() {
    const showDetailColumn = paperDetailOpen && Boolean(selectedPaperId)

    return (
      <section
        className={`library-layout ${showDetailColumn ? 'has-detail-open' : ''}`}
        style={
          showDetailColumn
            ? { gridTemplateColumns: `${layoutWidths.libraryListPx}px 6px minmax(0, 1fr)` }
            : undefined
        }
      >
        <div className="panel list-panel">
          <div className="panel-header library-panel-header">
            <div className="library-workbench-top">
              <div>
                <p className="eyebrow">资料库</p>
                <h2 className="library-workbench-title">文献工作台</h2>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={() => void handleImport()} disabled={isImporting}>
                  {isImporting ? '导入中…' : '导入文件'}
                </button>
              </div>
            </div>
            {statusMessage ? (
              <div className="banner library-inline-banner" role="status">
                {statusMessage}
              </div>
            ) : null}
            <div className="library-list-heading">
              <h3>文献列表</h3>
              <p className="muted">{librarySubtitle}</p>
              {displayedPapers.length > 0 ? (
                <p className="muted list-panel-hint">
                  点击条目在右侧展开文献详情；勾选左侧可一次将多篇文献加入会话上下文。在条目上右键可重命名或删除文献。
                </p>
              ) : null}
            </div>
            <div className="filter-row">
              <input
                className="search-input"
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="搜索标题、作者或正文…"
              />
              <select className="filter-select" value={fileTypeFilter} onChange={(event) => setFileTypeFilter(event.target.value)}>
                {fileTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isLoadingList && displayedPapers.length > 0 ? (
            <div className="paper-list-toolbar">
              <label className="paper-list-toolbar-select-all">
                <input
                  ref={paperListSelectAllRef}
                  type="checkbox"
                  checked={contextSelectStats.allDisplayedSelected}
                  onChange={() => toggleSelectAllDisplayedPapersForContext()}
                  aria-label="全选当前列表"
                />
                全选当前列表
              </label>
              <span className="muted paper-list-toolbar-count">
                已选 {contextSelectStats.contextSelectionCount} 篇
                {contextSelectStats.selectedOnPage > 0 && contextSelectStats.selectedOnPage < contextSelectStats.contextSelectionCount
                  ? `（本页 ${contextSelectStats.selectedOnPage} 篇）`
                  : null}
              </span>
              {contextSelectStats.contextSelectionCount > 0 ? (
                <button className="ghost-button" type="button" onClick={() => clearContextPaperSelection()}>
                  清除勾选
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="paper-list">
            {isLoadingList ? <p className="empty-state">加载中…</p> : null}
            {!isLoadingList && displayedPapers.length === 0 ? (
              <p className="empty-state">
                {libraryNav === 'recent'
                  ? '最近两周内没有更新的文献。'
                  : searchTerm.trim() || fileTypeFilter !== 'all' || selectedFolderId !== 'all' || selectedTagId !== 'all'
                    ? '没有符合当前筛选的文献。'
                    : '资料库为空，请点击「导入文件」开始。'}
              </p>
            ) : null}
            {displayedPapers.map((paper) => (
              <div
                key={paper.id}
                className="paper-list-row"
                onContextMenu={(event) => handlePaperContextMenu(event, paper.id)}
              >
                <input
                  type="checkbox"
                  className="paper-select-checkbox"
                  checked={contextPaperSelection.has(paper.id)}
                  onChange={() => toggleContextPaperInSelection(paper.id)}
                  aria-label={`将「${paper.title}」加入会话上下文`}
                />
                <button
                  type="button"
                  className={`paper-item ${paper.id === selectedPaperId ? 'is-selected' : ''}`}
                  title={
                    paper.matchContext
                      ? `${paper.title}\n匹配片段：${paper.matchContext}`
                      : paper.title
                  }
                  onClick={() => {
                    setSelectedPaperId(paper.id)
                    setPaperDetailOpen(true)
                  }}
                >
                  <span className="paper-item-name">{paper.title}</span>
                  <span className="paper-item-meta">
                    <span className="file-badge paper-item-type">{paper.fileType.toUpperCase()}</span>
                    <span className="paper-date paper-item-time">{formatDate(paper.updatedAt)}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {showDetailColumn ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整列表与详情宽度"
              className="splitter-v"
              onMouseDown={(e) => beginLayoutDrag('libraryList', e)}
            />
            <div className="panel detail-panel">
            {isLoadingDetail ? <p className="empty-state">加载详情…</p> : null}
            {!isLoadingDetail && !selectedPaper ? (
              <div className="empty-detail">
                <h3>加载中</h3>
                <p>正在拉取文献详情…</p>
              </div>
            ) : null}
            {!isLoadingDetail && selectedPaper ? (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">文献详情</p>
                  <h3>{selectedPaper.title}</h3>
                </div>
                <div className="button-row detail-header-actions">
                  <button
                    type="button"
                    className="icon-close-detail"
                    title="关闭详情"
                    aria-label="关闭详情"
                    onClick={() => setPaperDetailOpen(false)}
                  >
                    <X size={20} />
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      void handleCreateConversationFromSelectedPaper()
                    }}
                  >
                    以此文献对话
                  </button>
                  <span className="file-badge">{selectedPaper.fileType.toUpperCase()}</span>
                </div>
              </div>

              <div className="assignment-panel">
                <div>
                  <label className="field-label">文件夹</label>
                  <select
                    className="filter-select"
                    value={selectedPaper.folderId ?? 'none'}
                    onChange={(event) => void handleAssignFolder(event.target.value)}
                  >
                    <option value="none">未分配</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label">标签</label>
                  <div className="tag-list">
                    {tags.length === 0 ? <span className="muted">暂无标签</span> : null}
                    {tags.map((tag) => {
                      const selected = selectedPaper.tagIds.some((item) => item.id === tag.id)
                      return (
                        <button
                          key={tag.id}
                          className={`tag-pill ${selected ? 'is-selected' : ''}`}
                          onClick={() => void handleToggleTag(tag.id)}
                        >
                          <span className="tag-bullet" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <dl className="detail-grid">
                <div>
                  <dt>源文件</dt>
                  <dd>{selectedPaper.sourceName || '未知'}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{formatFileSize(selectedPaper.fileSize)}</dd>
                </div>
                <div>
                  <dt>作者</dt>
                  <dd>{selectedPaper.authors || '待补充'}</dd>
                </div>
                <div>
                  <dt>年份</dt>
                  <dd>{selectedPaper.year ?? '待补充'}</dd>
                </div>
                <div>
                  <dt>创建</dt>
                  <dd>{formatDate(selectedPaper.createdAt)}</dd>
                </div>
                <div>
                  <dt>更新</dt>
                  <dd>{formatDate(selectedPaper.updatedAt)}</dd>
                </div>
                <div className="detail-span">
                  <dt>路径</dt>
                  <dd>{selectedPaper.filePath}</dd>
                </div>
              </dl>

              <section className="detail-section">
                <h4>AI 摘要</h4>
                <p className="summary-box">
                  {selectedPaper.aiSummary ||
                    '尚未保存 AI 摘要。可在对话中获得回复后，使用「保存到文献」写入此处。'}
                </p>
              </section>

              <section className="detail-section">
                <h4>正文预览</h4>
                <pre className="content-preview">
                  {selectedPaper.fileContent || '暂不支持提取该类型的正文，或文件尚未解析。'}
                </pre>
              </section>
            </>
            ) : null}
            </div>
          </>
        ) : null}
      </section>
    )
  }

  function renderChatDock() {
    const selectedNoteContextCount = notes.filter((n) => !n.isGroup && contextNoteSelection.has(n.id)).length
    return (
      <div className="dock-inner">
        <div className="dock-header">
          <h3>对话</h3>
          <div className="dock-header-row">
            <select
              className="dock-select"
              value={selectedConversationId ?? ''}
              onChange={(event) => setSelectedConversationId(event.target.value || null)}
            >
              <option value="">选择会话…</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.name}
                </option>
              ))}
            </select>
            <button className="btn-icon" type="button" title="新对话" onClick={() => void handleNewEmptyConversation()}>
              <MessageSquarePlus size={18} />
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {conversationDetail
              ? `${conversationDetail.papers.length} 篇文献 · ${conversationDetail.contextNotes.length} 条笔记`
              : '未选择会话'}
          </p>
        </div>

        {!conversationDetail ? (
          <div className="empty-chat-cta">
            <p>选择或创建一个会话以开始提问。</p>
            <button className="ghost-button" type="button" onClick={() => void handleNewEmptyConversation()}>
              + 新建会话
            </button>
          </div>
        ) : (
          <>
            <div className="chat-context">
              {conversationDetail.papers.length === 0 && conversationDetail.contextNotes.length === 0 ? (
                <span className="muted">未附加文献或笔记上下文。</span>
              ) : null}
              {conversationDetail.papers.map((paper) => (
                <span key={paper.id} className="context-pill" title={paper.title}>
                  {paper.title}
                </span>
              ))}
              {conversationDetail.contextNotes.map((note) => (
                <span key={note.id} className="context-pill context-pill-note" title={`笔记：${note.title}`}>
                  {note.title}
                </span>
              ))}
            </div>

            <div className="message-list">
              {conversationDetail.messages.length === 0 ? (
                <p className="empty-state">就附加上下文提问，或请求摘要与方法梳理。</p>
              ) : null}
              {conversationDetail.messages.map((message) => (
                <div key={message.id} className={`message-bubble message-${message.role}`}>
                  <div className="message-role">{message.role}</div>
                  <div>{message.content}</div>
                </div>
              ))}
            </div>

            <div className="chat-composer">
              <div className="button-row">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!selectedConversationId || (contextPaperSelection.size === 0 && !selectedPaperId)}
                  onClick={() => void handleAddPapersToConversation()}
                >
                  {contextPaperSelection.size > 0
                    ? `将所选 ${contextPaperSelection.size} 篇加入会话`
                    : selectedPaperId
                      ? '将当前文献加入会话'
                      : '将文献加入会话'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!selectedConversationId || selectedNoteContextCount === 0}
                  onClick={() => void handleAddNotesToConversation()}
                >
                  {selectedNoteContextCount > 0
                    ? `将所选 ${selectedNoteContextCount} 条笔记加入会话`
                    : '将笔记加入会话'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!selectedConversationId || isExportingConversation}
                  onClick={() => void handleExportConversation()}
                >
                  {isExportingConversation ? '导出中…' : '导出 Markdown'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!selectedPaperId || !conversationDetail || isSavingSummary}
                  onClick={() => void handleSaveSummaryToPaper()}
                >
                  {isSavingSummary ? '保存中…' : '保存回复到文献'}
                </button>
              </div>
              <textarea
                className="note-textarea"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="提问、对比结论、请求摘要或提炼开放问题…"
                rows={4}
              />
              <button
                className="primary-button"
                type="button"
                disabled={isSendingMessage || !chatInput.trim() || !selectedConversationId}
                onClick={() => void handleSendMessage()}
              >
                {isSendingMessage ? '发送中…' : '发送'}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  function renderNotesDock() {
    return (
      <div className="dock-inner">
        <div className="dock-header">
          <h3>笔记本</h3>
          <p className="muted">
            {selectedPaperTitleHint ? `当前文献：${selectedPaperTitleHint}` : '未选中文献时显示全局笔记'}
          </p>
        </div>
        <div className="note-dock-toolbar">
          <div className="note-dock-toolbar-left">
            <label className="note-toolbar-select-all">
              <input
                ref={noteListSelectAllRef}
                type="checkbox"
                disabled={noteContextSelectStats.selectableCount === 0}
                checked={noteContextSelectStats.selectableCount > 0 && noteContextSelectStats.allSelected}
                onChange={() => toggleSelectAllNotesForContext()}
              />
              <span>全选</span>
            </label>
          </div>
          <div className="note-dock-toolbar-right">
            <button className="btn-icon" type="button" title="新建分组" onClick={() => setIsCreatingNoteGroup((v) => !v)}>
              <FolderPlus size={16} />
            </button>
            <button className="btn-icon" type="button" title="新建笔记" onClick={() => setIsCreatingNote((v) => !v)}>
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
        {isCreatingNoteGroup || isCreatingNote ? (
          <div className="inline-create-dock">
            {isCreatingNoteGroup ? (
              <div className="inline-create">
                <input
                  className="inline-create-input"
                  value={newNoteGroupTitle}
                  onChange={(event) => setNewNoteGroupTitle(event.target.value)}
                  placeholder="分组名称"
                />
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={() => void handleCreateNote(true)}>
                    保存分组
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsCreatingNoteGroup(false)
                      setNewNoteGroupTitle('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            {isCreatingNote ? (
              <div className="inline-create" style={{ marginTop: isCreatingNoteGroup ? 8 : 0 }}>
                <input
                  className="inline-create-input"
                  value={newNoteTitle}
                  onChange={(event) => setNewNoteTitle(event.target.value)}
                  placeholder="笔记标题"
                />
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={() => void handleCreateNote(false)}>
                    保存笔记
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsCreatingNote(false)
                      setNewNoteTitle('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="notes-dock-body">
          <div className="notes-layout-dock">
            <div className="note-tree">
              {notes.length === 0 ? <p className="empty-state">暂无笔记</p> : null}
              {notes.map((note) => (
                <div
                  key={note.id}
                  className={`note-tree-row ${note.id === selectedNoteId ? 'is-selected' : ''}`}
                  style={{ paddingLeft: `${4 + (noteDepthMap.get(note.id) ?? 0) * 16}px` }}
                >
                  {!note.isGroup ? (
                    <input
                      type="checkbox"
                      className="note-context-checkbox"
                      checked={contextNoteSelection.has(note.id)}
                      onChange={() => toggleContextNoteSelection(note.id)}
                      aria-label={`将笔记「${note.title}」加入对话上下文`}
                    />
                  ) : (
                    <span className="note-context-checkbox-spacer" aria-hidden />
                  )}
                  <button
                    type="button"
                    className={`note-tree-item ${note.id === selectedNoteId ? 'is-selected' : ''}`}
                    onClick={() => setSelectedNoteId(note.id)}
                    onContextMenu={(event) => handleNoteContextMenu(event, note)}
                  >
                    <span>{note.isGroup ? '＃' : '•'}</span>
                    <span className="note-tree-item-title">{note.title}</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="note-editor">
              {activeNote ? (
                <>
                  <input
                    className="note-title-input"
                    value={editingNoteTitle}
                    onChange={(event) => setEditingNoteTitle(event.target.value)}
                    placeholder="标题"
                  />
                  <textarea
                    className="note-textarea"
                    value={editingNoteContent}
                    onChange={(event) => setEditingNoteContent(event.target.value)}
                    placeholder="记录想法、摘录、待办…"
                  />
                  <button className="primary-button" type="button" onClick={() => void handleSaveNote()}>
                    保存笔记
                  </button>
                </>
              ) : (
                <div className="empty-detail">
                  <h3>选择一条笔记</h3>
                  <p>先创建分组或笔记，再在此编辑。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderSettingsPage() {
    return (
      <div className="settings-page">
        <div className="active-preset-card">
          <p className="eyebrow">当前模型</p>
          {activePreset ? (
            <>
              <h3>{activePreset.name}</h3>
              <p className="active-preset-meta">
                {activePreset.provider} · {activePreset.model}
              </p>
              <p className="muted" style={{ marginBottom: 12 }}>
                {activePreset.baseUrl}
              </p>
            </>
          ) : (
            <>
              <h3>未配置</h3>
              <p className="active-preset-meta">请在下方的预设中选择一个并点击「启用」，或新建自定义预设。</p>
            </>
          )}
          <button className="primary-button" type="button" onClick={handleTestConnection}>
            测试连接
          </button>
        </div>

        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>API 预设</h3>
          <div className="preset-grid">
            {aiSettings.presets.map((preset) => {
              const isActive = preset.id === aiSettings.activePresetId
              return (
                <div key={preset.id} className={`preset-card ${isActive ? 'is-active' : ''}`}>
                  <div className="preset-card-header">
                    <strong>{preset.name}</strong>
                    {preset.isBuiltin ? (
                      <span className="file-badge" style={{ fontSize: 10 }}>
                        内置
                      </span>
                    ) : null}
                  </div>
                  <div className="preset-endpoint">{preset.baseUrl}</div>
                  <div className="preset-model">{preset.model}</div>
                  <div className="preset-card-actions">
                    <button
                      className={`btn-small ${isActive ? 'primary' : ''}`}
                      type="button"
                      disabled={isActive}
                      onClick={() => void handleSelectActivePreset(preset.id)}
                    >
                      {isActive ? '已启用' : '启用'}
                    </button>
                    <button
                      className="btn-small"
                      type="button"
                      onClick={() => {
                        setPresetDraft(preset)
                        setStatusMessage(`正在编辑：${preset.name}`)
                      }}
                    >
                      编辑
                    </button>
                  </div>
                </div>
              )
            })}
            <div className="preset-card" style={{ borderStyle: 'dashed', alignContent: 'center' }}>
              <button
                className="ghost-button"
                type="button"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setPresetDraft(defaultPresetDraft())}
              >
                + 新建自定义预设
              </button>
            </div>
          </div>
        </div>

        <div className="settings-editor">
          <h4>{presetDraft.id ? `编辑预设` : '新建预设'}</h4>
          <label className="field-label">
            名称
            <input
              className="search-input"
              value={presetDraft.name}
              onChange={(event) => setPresetDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="field-label">
            提供商
            <input
              className="search-input"
              value={presetDraft.provider}
              onChange={(event) => setPresetDraft((current) => ({ ...current, provider: event.target.value }))}
            />
          </label>
          <label className="field-label">
            Base URL
            <input
              className="search-input"
              value={presetDraft.baseUrl}
              onChange={(event) => setPresetDraft((current) => ({ ...current, baseUrl: event.target.value }))}
            />
          </label>
          <label className="field-label">
            模型
            <input
              className="search-input"
              value={presetDraft.model}
              onChange={(event) => setPresetDraft((current) => ({ ...current, model: event.target.value }))}
            />
          </label>
          <label className="field-label">
            API Key
            <input
              className="search-input"
              type="password"
              value={presetDraft.apiKey}
              onChange={(event) => setPresetDraft((current) => ({ ...current, apiKey: event.target.value }))}
            />
          </label>
          <button className="primary-button" type="button" onClick={() => void handleSavePreset()}>
            保存预设
          </button>
        </div>

        <div className="about-card">
          <h4 style={{ marginTop: 0 }}>关于 PaperBox</h4>
          <p>
            PaperBox 是面向个人研究的本地桌面应用，将文献归档、全文检索、笔记与 AI 对话整合在同一工作流中。数据保存在本机，可随时离线浏览资料库。
          </p>
          <p className="about-version">版本 v0.1.0 · 数据库：{bootstrap?.dbPath ?? '…'}</p>
        </div>
      </div>
    )
  }

  const navAllActive = mainView === 'library' && libraryNav === 'all'
  const navRecentActive = mainView === 'library' && libraryNav === 'recent'

  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        style={{
          width: layoutWidths.sidebarPx,
          minWidth: layoutWidths.sidebarPx,
          maxWidth: layoutWidths.sidebarPx
        }}
      >
        <div className="brand">
          <h1 className="brand-title">PaperBox</h1>
          <p className="brand-sub">本地文献与 AI 研究工作台</p>
        </div>

        <div className="sidebar-scroll">
          <nav className="nav-primary">
            <button type="button" className={`nav-item ${navAllActive ? 'is-active' : ''}`} onClick={goAllPapers}>
              <BookOpen size={18} />
              全部文献
            </button>
            <button type="button" className={`nav-item ${navRecentActive ? 'is-active' : ''}`} onClick={goRecent}>
              <Clock size={18} />
              最近
            </button>
            <button type="button" className={`nav-item ${libraryNav === 'tags' && mainView === 'library' ? 'is-active' : ''}`} onClick={goTagsInSidebar}>
              <Tag size={18} />
              标签
            </button>
          </nav>

          <section className="sidebar-section">
            <div className="section-header">
              <h3 className="sidebar-section-title">文件夹</h3>
              <button className="btn-icon" type="button" onClick={() => setIsCreatingFolder((v) => !v)} title="新建文件夹">
                +
              </button>
            </div>
            {isCreatingFolder ? (
              <div className="inline-create">
                <input
                  className="inline-create-input"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="文件夹名称"
                />
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={() => void handleCreateFolder()}>
                    保存
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsCreatingFolder(false)
                      setNewFolderName('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className={`filter-chip ${selectedFolderId === 'all' ? 'is-selected' : ''}`}
              onClick={() => {
                setMainView('library')
                setSelectedFolderId('all')
              }}
            >
              <span>全部文件夹</span>
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={`filter-chip ${selectedFolderId === folder.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setContextMenu(null)
                  setMainView('library')
                  setSelectedFolderId(folder.id)
                }}
                onContextMenu={(event) => handleFolderContextMenu(event, folder.id)}
              >
                <span>{folder.name}</span>
                <span>{folder.paperCount}</span>
              </button>
            ))}
          </section>

          <section className="sidebar-section" ref={tagsSectionRef} id="sidebar-tags">
            <div className="section-header">
              <h3 className="sidebar-section-title">标签筛选</h3>
              <button className="btn-icon" type="button" onClick={() => setIsCreatingTag((v) => !v)} title="新建标签">
                +
              </button>
            </div>
            {isCreatingTag ? (
              <div className="inline-create">
                <input
                  className="inline-create-input"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  placeholder="标签名称"
                />
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={() => void handleCreateTag()}>
                    保存
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setIsCreatingTag(false)
                      setNewTagName('')
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className={`filter-chip ${selectedTagId === 'all' ? 'is-selected' : ''}`}
              onClick={() => {
                setMainView('library')
                setSelectedTagId('all')
              }}
            >
              <span>全部标签</span>
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`filter-chip ${selectedTagId === tag.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setContextMenu(null)
                  setMainView('library')
                  setSelectedTagId(tag.id)
                }}
                onContextMenu={(event) => handleTagContextMenu(event, tag.id)}
              >
                <span className="tag-chip-label">
                  <span className="tag-bullet" style={{ backgroundColor: tag.color }} />
                  <span>{tag.name}</span>
                </span>
                <span>{tag.paperCount}</span>
              </button>
            ))}
          </section>

          <section className="sidebar-section">
            <div className="section-header">
              <h3 className="sidebar-section-title">对话</h3>
              <button className="btn-icon" type="button" title="新对话" onClick={() => void handleNewEmptyConversation()}>
                +
              </button>
            </div>
            {conversations.length === 0 ? <p className="muted" style={{ margin: 0 }}>暂无会话</p> : null}
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`conv-item ${conversation.id === selectedConversationId ? 'is-selected' : ''}`}
                onClick={() => {
                  setContextMenu(null)
                  setSelectedConversationId(conversation.id)
                  setChatPaneOpen(true)
                }}
                onContextMenu={(event) => handleConversationContextMenu(event, conversation.id)}
              >
                <MessagesSquare size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conversation.name}
                </span>
                <span className="conv-meta">
                  {conversation.paperIds.length} 篇 · {conversation.noteIds.length} 笔记
                </span>
              </button>
            ))}
          </section>
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            className="btn-dark"
            onClick={() => setChatPaneOpen((v) => !v)}
            aria-pressed={chatPaneOpen}
          >
            {chatPaneOpen ? (
              <>
                <PanelRightClose size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                隐藏对话
              </>
            ) : (
              <>
                <PanelRightOpen size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                显示对话
              </>
            )}
          </button>
          <button
            type="button"
            className="btn-dark"
            onClick={() => setNotebookPaneOpen((v) => !v)}
            aria-pressed={notebookPaneOpen}
          >
            {notebookPaneOpen ? '隐藏笔记本' : '显示笔记本'}
          </button>
          <button
            type="button"
            className="btn-dark"
            onClick={() => {
              setMainView('settings')
            }}
          >
            <Settings2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            设置
          </button>
          <p className="sidebar-meta">
            {activePreset ? `模型：${activePreset.name}` : '未配置模型'}
          </p>
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        className="splitter-v"
        onMouseDown={(e) => beginLayoutDrag('sidebar', e)}
      />

      <main className="main-stage">
        <div
          className={mainView === 'settings' ? 'main-stage-inner main-stage-inner--settings' : 'main-stage-inner'}
        >
          {mainView === 'settings' ? (
            <>
              <header className="workspace-header workspace-header--settings">
                <div>
                  <p className="eyebrow">系统</p>
                  <h2>设置</h2>
                </div>
              </header>
              {statusMessage ? (
                <div className="banner" role="status">
                  {statusMessage}
                </div>
              ) : null}
              {renderSettingsPage()}
            </>
          ) : (
            renderLibraryMain()
          )}
        </div>
      </main>

      {chatPaneOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话栏宽度"
          className="splitter-v"
          onMouseDown={(e) => beginLayoutDrag('mainChat', e)}
        />
      ) : null}

      <aside
        className={`dock dock-chat ${chatPaneOpen ? 'is-open' : 'is-closed'}`}
        style={
          chatPaneOpen
            ? { width: layoutWidths.chatDockPx, minWidth: layoutWidths.chatDockPx }
            : undefined
        }
        aria-hidden={!chatPaneOpen}
      >
        {renderChatDock()}
      </aside>

      {chatPaneOpen && notebookPaneOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话与笔记本分栏宽度"
          className="splitter-v"
          onMouseDown={(e) => beginLayoutDrag('chatNotes', e)}
        />
      ) : null}

      {!chatPaneOpen && notebookPaneOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整笔记本栏宽度"
          className="splitter-v"
          onMouseDown={(e) => beginLayoutDrag('mainNotes', e)}
        />
      ) : null}

      <aside
        className={`dock dock-notes ${notebookPaneOpen ? 'is-open' : 'is-closed'}`}
        style={
          notebookPaneOpen
            ? { width: layoutWidths.notesDockPx, minWidth: layoutWidths.notesDockPx }
            : undefined
        }
        aria-hidden={!notebookPaneOpen}
      >
        {renderNotesDock()}
      </aside>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          {contextMenu.kind === 'noteGroup' ? (
            <>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => openRenameNote(contextMenu.noteId)}
              >
                重命名
              </button>
              <button
                type="button"
                className="context-menu-item danger"
                role="menuitem"
                onClick={() => void handleDeleteNoteEntry(contextMenu.noteId)}
              >
                删除
              </button>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => void handleAddNoteUnderGroup(contextMenu.noteId)}
              >
                添加笔记
              </button>
            </>
          ) : contextMenu.kind === 'noteItem' ? (
            <>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => openRenameNote(contextMenu.noteId)}
              >
                重命名
              </button>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => openMoveNoteDialog(contextMenu.noteId)}
              >
                移动到分组
              </button>
              <button
                type="button"
                className="context-menu-item danger"
                role="menuitem"
                onClick={() => void handleDeleteNoteEntry(contextMenu.noteId)}
              >
                删除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  if (contextMenu.kind === 'conversation') openRenameConversation(contextMenu.conversationId)
                  else if (contextMenu.kind === 'folder') openRenameFolder(contextMenu.folderId)
                  else if (contextMenu.kind === 'tag') openRenameTag(contextMenu.tagId)
                  else openRenamePaper(contextMenu.paperId)
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="context-menu-item danger"
                role="menuitem"
                onClick={() => {
                  if (contextMenu.kind === 'conversation') void handleDeleteConversationById(contextMenu.conversationId)
                  else if (contextMenu.kind === 'folder') void handleDeleteFolderById(contextMenu.folderId)
                  else if (contextMenu.kind === 'tag') void handleDeleteTagById(contextMenu.tagId)
                  else void handleDeletePaperById(contextMenu.paperId)
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
      ) : null}

      {renameDialog ? (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRenameDialog(null)
          }}
        >
          <div className="rename-modal" role="dialog" aria-labelledby="rename-dialog-title" onMouseDown={(e) => e.stopPropagation()}>
            <h3 id="rename-dialog-title" className="rename-modal-title">
              {renameDialog.kind === 'conversation'
                ? '重命名会话'
                : renameDialog.kind === 'folder'
                  ? '重命名文件夹'
                  : renameDialog.kind === 'tag'
                    ? '重命名标签'
                    : renameDialog.kind === 'note'
                      ? renameDialog.isGroup
                        ? '重命名分组'
                        : '重命名笔记'
                      : '重命名文献'}
            </h3>
            <label className="field-label" htmlFor="rename-entity-input">
              {renameDialog.kind === 'paper'
                ? '标题'
                : renameDialog.kind === 'note'
                  ? renameDialog.isGroup
                    ? '名称'
                    : '标题'
                  : '名称'}
            </label>
            <input
              id="rename-entity-input"
              ref={renameTitleInputRef}
              className="search-input"
              value={renameDialog.title}
              onChange={(event) => setRenameDialog((current) => (current ? { ...current, title: event.target.value } : null))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleConfirmRename()
                if (event.key === 'Escape') setRenameDialog(null)
              }}
            />
            <div className="rename-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setRenameDialog(null)}>
                取消
              </button>
              <button type="button" className="primary-button" onClick={() => void handleConfirmRename()}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {moveNoteDialog ? (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoveNoteDialog(null)
          }}
        >
          <div
            className="rename-modal"
            role="dialog"
            aria-labelledby="move-note-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="move-note-dialog-title" className="rename-modal-title">
              移动到分组
            </h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
              选择目标分组，或移回顶级。仅在当前笔记本范围内有效。
            </p>
            <div className="move-note-parent-list" role="radiogroup" aria-label="目标分组">
              <label className="move-note-parent-option">
                <input
                  type="radio"
                  name="move-note-parent"
                  checked={moveNoteDialog.selectedParentId === null}
                  onChange={() => setMoveNoteDialog((d) => (d ? { ...d, selectedParentId: null } : null))}
                />
                <span>顶级（不分组）</span>
              </label>
              {moveNoteGroupOptions.map((g) => (
                <label key={g.id} className="move-note-parent-option">
                  <input
                    type="radio"
                    name="move-note-parent"
                    checked={moveNoteDialog.selectedParentId === g.id}
                    onChange={() => setMoveNoteDialog((d) => (d ? { ...d, selectedParentId: g.id } : null))}
                  />
                  <span style={{ paddingLeft: `${(noteDepthMap.get(g.id) ?? 0) * 12}px` }}>
                    <span className="move-note-parent-marker">＃</span> {g.title}
                  </span>
                </label>
              ))}
            </div>
            <div className="rename-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setMoveNoteDialog(null)}>
                取消
              </button>
              <button type="button" className="primary-button" onClick={() => void handleConfirmMoveNote()}>
                移动
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
