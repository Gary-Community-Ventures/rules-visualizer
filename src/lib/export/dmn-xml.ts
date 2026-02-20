import type {
  Model,
  ModelNode,
  Constant,
  Context,
  DecisionTable,
  ContextEntry,
} from '@/lib/model'

// ─── XML Helpers ─────────────────────────────────────────────────

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Always use xmlEscape for text content — no CDATA (avoids ]]> injection). */
function xmlText(str: string): string {
  return xmlEscape(str)
}

function optAttr(name: string, value?: string): string {
  if (value === undefined) return ''
  return ` ${name}="${xmlEscape(value)}"`
}

/** Sanitize a string to a valid XML NCName for use as an xsd:ID attribute.
 *  - Replaces non-alphanumeric/underscore/hyphen/dot chars with '_'
 *  - Prepends '_' if it starts with a digit, hyphen, or dot */
export function xmlId(id: string): string {
  if (!id) return '_empty'
  let sanitized = id.replace(/[^a-zA-Z0-9_\-\.]/g, '_')
  if (/^[^a-zA-Z_]/.test(sanitized)) {
    sanitized = `_${sanitized}`
  }
  return sanitized
}

/** Deterministic sub-element ID derived from parent + suffix. */
function subId(parentId: string, suffix: string): string {
  return xmlId(`${parentId}_${suffix}`)
}

// ─── Element Renderers ───────────────────────────────────────────

function renderInputData(node: ModelNode): string {
  return [
    `  <inputData id="${xmlId(node.id)}" name="${xmlEscape(node.name)}">`,
    `    <variable id="${subId(node.id, 'var')}" name="${xmlEscape(node.name)}"${optAttr('typeRef', node.typeRef)} />`,
    `  </inputData>`,
  ].join('\n')
}

function renderInformationRequirements(
  node: ModelNode,
  model: Model
): string[] {
  return node.dependencies
    .filter((depId) => {
      if (!model.nodes[depId]) {
        console.warn(
          `DMN export: node "${node.id}" references unknown dependency "${depId}", skipping`
        )
        return false
      }
      return true
    })
    .map((depId, i) => {
      const depNode = model.nodes[depId]
      const reqId = subId(node.id, `ir_${i}`)
      const tag =
        depNode.content.type === 'input' ? 'requiredInput' : 'requiredDecision'
      return [
        `    <informationRequirement id="${reqId}">`,
        `      <${tag} href="#${xmlId(depId)}" />`,
        `    </informationRequirement>`,
      ].join('\n')
    })
}

function renderLiteralExpression(constant: Constant, nodeId: string): string {
  return [
    `    <literalExpression id="${subId(nodeId, 'expr')}"${optAttr('typeRef', constant.typeRef)}>`,
    `      <text>${xmlText(constant.text)}</text>`,
    `    </literalExpression>`,
  ].join('\n')
}

function renderContextEntry(
  entry: ContextEntry,
  indent: string,
  parentId: string,
  index: number
): string {
  const entryId = subId(parentId, `ce_${index}`)
  const lines: string[] = []
  lines.push(`${indent}<contextEntry id="${entryId}">`)
  if (entry.name !== '_return') {
    lines.push(
      `${indent}  <variable id="${subId(entryId, 'var')}" name="${xmlEscape(entry.name)}"${optAttr('typeRef', entry.expression.typeRef)} />`
    )
  }
  lines.push(
    `${indent}  <literalExpression id="${subId(entryId, 'expr')}">`,
    `${indent}    <text>${xmlText(entry.expression.text)}</text>`,
    `${indent}  </literalExpression>`
  )
  lines.push(`${indent}</contextEntry>`)
  return lines.join('\n')
}

function renderContext(context: Context, nodeId: string): string {
  const exprId = subId(nodeId, 'expr')
  const lines: string[] = []
  lines.push(`    <context id="${exprId}">`)
  for (let i = 0; i < context.entries.length; i++) {
    lines.push(renderContextEntry(context.entries[i], '      ', exprId, i))
  }
  lines.push(`    </context>`)
  return lines.join('\n')
}

function renderDecisionTable(dt: DecisionTable, nodeId: string): string {
  const lines: string[] = []
  lines.push(
    `    <decisionTable id="${subId(nodeId, 'expr')}" hitPolicy="${xmlEscape(dt.hitPolicy)}"${optAttr('aggregation', dt.aggregation)}>`
  )

  for (const input of dt.inputClauses) {
    lines.push(
      `      <input id="${xmlId(input.id)}" label="${xmlEscape(input.inputExpression)}">`
    )
    lines.push(
      `        <inputExpression id="${subId(input.id, 'expr')}" typeRef="${xmlEscape(input.inputExpressionTypeRef ?? 'string')}">`,
      `          <text>${xmlText(input.inputExpression)}</text>`,
      `        </inputExpression>`
    )
    lines.push(`      </input>`)
  }

  for (const output of dt.outputClauses) {
    lines.push(
      `      <output id="${xmlId(output.id)}" label="${xmlEscape(output.name)}" name="${xmlEscape(output.name)}"${optAttr('typeRef', output.typeRef)} />`
    )
  }

  for (const rule of dt.rules) {
    lines.push(`      <rule id="${xmlId(rule.id)}">`)
    for (let i = 0; i < rule.inputEntries.length; i++) {
      const ieId = subId(rule.id, `ie_${i}`)
      lines.push(`        <inputEntry id="${ieId}">`)
      lines.push(`          <text>${xmlText(rule.inputEntries[i])}</text>`)
      lines.push(`        </inputEntry>`)
    }
    for (let i = 0; i < rule.outputEntries.length; i++) {
      const oeId = subId(rule.id, `oe_${i}`)
      lines.push(`        <outputEntry id="${oeId}">`)
      lines.push(`          <text>${xmlText(rule.outputEntries[i])}</text>`)
      lines.push(`        </outputEntry>`)
    }
    lines.push(`      </rule>`)
  }

  lines.push(`    </decisionTable>`)
  return lines.join('\n')
}

function renderDecision(node: ModelNode, model: Model): string {
  const lines: string[] = []
  lines.push(
    `  <decision id="${xmlId(node.id)}" name="${xmlEscape(node.name)}">`
  )
  lines.push(
    `    <variable id="${subId(node.id, 'var')}" name="${xmlEscape(node.name)}"${optAttr('typeRef', node.typeRef)} />`
  )

  lines.push(...renderInformationRequirements(node, model))

  const content = node.content
  if (content.type === 'constant') {
    lines.push(renderLiteralExpression(content, node.id))
  } else if (content.type === 'context') {
    lines.push(renderContext(content, node.id))
  } else if (content.type === 'decisionTable') {
    lines.push(renderDecisionTable(content, node.id))
  }

  lines.push(`  </decision>`)
  return lines.join('\n')
}

// ─── Public API ──────────────────────────────────────────────────

export function exportModelToDmnXml(model: Model): string {
  const lines: string[] = []

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(
    `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"` +
      ` id="${xmlId(model.id)}"` +
      ` name="${xmlEscape(model.name)}"` +
      ` namespace="${xmlEscape(model.namespace)}">`
  )

  // Sort nodes by ID for deterministic output
  const nodes = Object.values(model.nodes).sort((a, b) =>
    a.id.localeCompare(b.id)
  )

  // Render input nodes first, then decision nodes
  for (const node of nodes) {
    if (node.content.type === 'input') {
      lines.push(renderInputData(node))
    }
  }

  for (const node of nodes) {
    if (node.content.type !== 'input') {
      lines.push(renderDecision(node, model))
    }
  }

  lines.push(`</definitions>`)

  return lines.join('\n')
}
