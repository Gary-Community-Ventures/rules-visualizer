import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from 'rules-visualizer-factgraph-core'

// pdfjs-dist v5 ships an ESM build that runs in Node via the legacy bundle
// (no Worker, no DOM). Loaded lazily so the AI tools don't pay the cost
// unless someone actually asks for policy text.
type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{
      items: ({ str: string } | unknown)[]
    }>
  }>
}

let pdfjsLibPromise: Promise<{
  getDocument: (args: { data: Uint8Array }) => { promise: Promise<PdfDoc> }
}> | null = null

function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<
      typeof import('pdfjs-dist/legacy/build/pdf.mjs') & {
        getDocument: (args: { data: Uint8Array }) => {
          promise: Promise<PdfDoc>
        }
      }
    >
  }
  return pdfjsLibPromise
}

const docCache = new Map<string, Promise<PdfDoc | null>>()
const pageTextCache = new Map<string, string>()

async function loadPdf(absFile: string): Promise<PdfDoc | null> {
  let p = docCache.get(absFile)
  if (p) return p
  p = (async () => {
    if (!fs.existsSync(absFile)) return null
    const buf = fs.readFileSync(absFile)
    const lib = await getPdfjs()
    return await lib.getDocument({ data: new Uint8Array(buf) }).promise
  })()
  docCache.set(absFile, p)
  return p
}

type RefsManifest = {
  documents: { id: string; file?: string }[]
}

function resolveDocumentFile(
  rulesetId: string,
  documentId: string
): string | null {
  const dataDir = getDataDir()
  if (!dataDir) return null
  const refsPath = path.join(dataDir, rulesetId, 'references.json')
  if (!fs.existsSync(refsPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(refsPath, 'utf-8')) as RefsManifest
    const doc = raw.documents.find((d) => d.id === documentId)
    if (!doc?.file) return null
    return path.join(dataDir, rulesetId, doc.file)
  } catch {
    return null
  }
}

/**
 * Extract the visible text on a specific PDF page. Caches per (file, page)
 * so repeated lookups during a single AI call are cheap. Returns '' if the
 * document is missing, the file doesn't exist, or the page is out of range.
 */
export async function getPageText(
  rulesetId: string,
  documentId: string,
  pageNum: number
): Promise<string> {
  const absFile = resolveDocumentFile(rulesetId, documentId)
  if (!absFile) return ''
  const key = `${absFile}::${pageNum}`
  const cached = pageTextCache.get(key)
  if (cached !== undefined) return cached
  try {
    const pdf = await loadPdf(absFile)
    if (!pdf) return ''
    if (pageNum < 1 || pageNum > pdf.numPages) return ''
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) =>
        item && typeof item === 'object' && 'str' in item
          ? String((item as { str: unknown }).str ?? '')
          : ''
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pageTextCache.set(key, text)
    return text
  } catch {
    return ''
  }
}
