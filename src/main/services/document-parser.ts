const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.yml',
  '.yaml'
])

export async function extractDocumentContent(
  fileBuffer: Buffer,
  ext: string
): Promise<string | null> {
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = fileBuffer.toString('utf-8').trim()
    return text.length > 0 ? text.slice(0, 100_000) : null
  }

  if (ext === '.pdf') {
    return extractPdfContent(fileBuffer)
  }

  return null
}

async function extractPdfContent(fileBuffer: Buffer): Promise<string | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBuffer),
      useWorkerFetch: false,
      isEvalSupported: false
    })

    const document = await loadingTask.promise
    const pageTexts: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (text) {
        pageTexts.push(text)
      }
    }

    await document.destroy()

    const merged = pageTexts.join('\n\n').trim()
    return merged.length > 0 ? merged.slice(0, 150_000) : null
  } catch (error) {
    console.warn('Failed to extract PDF content:', error)
    return null
  }
}
