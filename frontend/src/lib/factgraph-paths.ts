import { getNodePath } from '@/context/model-context'
import type { ModelNodes } from '@/lib/model'

const DAY_EXTRACTORS = new Set(['year', 'month', 'day', 'ordinal'])

export function resolveFactGraphPath(rawPath: string, currentPath?: string) {
  let path = rawPath
  if (path.startsWith('..') && currentPath) {
    const segments = currentPath.split('/').filter(Boolean)
    segments.pop()
    let remaining = rawPath
    while (remaining.startsWith('../')) {
      remaining = remaining.slice(3)
    }
    path = '/' + segments.join('/') + '/' + remaining
  } else if (/^\^+(\/|$)/.test(path) && currentPath) {
    const slashIdx = path.indexOf('/')
    const head = slashIdx === -1 ? path : path.slice(0, slashIdx)
    const tail = slashIdx === -1 ? '' : path.slice(slashIdx + 1)
    const segments = currentPath.split('/').filter(Boolean)
    for (let i = 0; i < head.length; i++) segments.pop()
    const base = segments.length === 0 ? '/' : '/' + segments.join('/')
    path =
      tail.length === 0 ? base : base === '/' ? '/' + tail : base + '/' + tail
  }
  return path
}

export function findFactGraphNodeIdByPath(nodes: ModelNodes, path: string) {
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (getNodePath(node.content) === path) return nodeId
  }

  const segments = path.split('/').filter(Boolean)
  const extractor = segments.at(-1)
  if (!extractor || !DAY_EXTRACTORS.has(extractor)) return undefined

  const basePath = '/' + segments.slice(0, -1).join('/')
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (getNodePath(node.content) !== basePath) continue
    const content = node.content
    if (content.format !== 'factGraph') continue
    const typeName =
      content.type === 'writable' ? content.typeName : content.dataType
    if (typeName === 'Day') return nodeId
  }
  return undefined
}
