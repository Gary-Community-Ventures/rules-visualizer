// Shared types for the rules-visualizer monorepo.
// This is the single source of truth — frontend and factgraph-server re-export from here.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Rule format identifier */
export type RuleFormat = 'rac' | 'factGraph'

/** Universal node role — consistent across all formats */
export type NodeRole = 'input' | 'constant' | 'computed'

/** Fact Graph writable type names — matches Direct File XML element names */
export type WritableTypeName =
  | 'String'
  | 'Boolean'
  | 'Dollar'
  | 'Int'
  | 'Short'
  | 'Byte'
  | 'Rational'
  | 'Day'
  | 'Enum'
  | 'MultiEnum'
  | 'Collection'
  | 'CollectionItem'
  | 'Address'
  | 'BankAccount'
  | 'EmailAddress'
  | 'PhoneNumber'
  | 'TIN'
  | 'EIN'
  | 'PIN'
  | 'IPPIN'

/** Fact Graph validation limit — type names match Direct File XML */
export type Limit = {
  type:
    | 'Min'
    | 'Max'
    | 'MinLength'
    | 'MaxLength'
    | 'Match'
    | 'Contains'
    | 'MaxCollectionSize'
  value: string | number
}

// ---------------------------------------------------------------------------
// RAC content types (mirrors RAC AST/IR)
// ---------------------------------------------------------------------------

export type RacVariable = {
  format: 'rac'
  type: 'variable'
  role: NodeRole
  path: string
  entity?: string
  label?: string
  unit?: string
  default?: string
  expression?: string // human-readable for now, will become AST
  source?: string
  logic?: string // the calculation/logic portion of the source
  temporalValues?: { from: string; to?: string; expression: string }[]
}

export type RacEntityField = {
  name: string
  dtype: string // native RAC type string (e.g. "str", "int", "date", "money")
  nullable?: boolean
  default?: string
}

export type RacForeignKey = {
  field: string
  target: string
}

export type RacEntity = {
  format: 'rac'
  type: 'entity'
  fields: RacEntityField[]
  foreignKeys?: RacForeignKey[]
}

// ---------------------------------------------------------------------------
// Fact Graph content types (mirrors Fact Graph XML/config)
// ---------------------------------------------------------------------------

export type FactGraphWritable = {
  format: 'factGraph'
  type: 'writable'
  role: 'input'
  path: string
  typeName: WritableTypeName
  label?: string
  enumOptionsPath?: string
  limits?: Limit[]
  collectionItemPath?: string
  logic?: string // inner <Writable> or <Derived> XML
}

export type FactGraphDerived = {
  format: 'factGraph'
  type: 'derived'
  role: 'constant' | 'computed'
  path: string
  label?: string
  dataType?: string // inferred return type (Dollar, Int, Boolean, Day, etc.)
  logic?: string // inner <Writable> or <Derived> XML
}

// ---------------------------------------------------------------------------
// Node content union
// ---------------------------------------------------------------------------

export type NodeContent =
  | RacVariable
  | RacEntity
  | FactGraphWritable
  | FactGraphDerived

// ---------------------------------------------------------------------------
// Shared graph shell (format-agnostic)
// ---------------------------------------------------------------------------

export type ModelNode = {
  id: string
  name: string
  dependencies: string[] // pre-computed by backend/converter
  content: NodeContent
  overridable: boolean // whether this node's value can be overridden during execution
  description?: string
  tags?: string[]
  references?: ResolvedReference[]
}

export type ModelNodes = Record<string, ModelNode>

export type Model = {
  id: string
  name: string
  format: RuleFormat
  nodes: ModelNodes
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export type RulesetSummary = {
  id: string
  name: string
  format: RuleFormat
}

// ---------------------------------------------------------------------------
// Policy references (citations to source policy documents)
// ---------------------------------------------------------------------------

/** A source policy document (e.g. a statute, regulation, or rule manual) */
export type PolicyDocument = {
  id: string
  title: string
  url?: string
  /** Path to a local file (e.g. PDF) relative to the ruleset data directory */
  file?: string
}

/** A bounding rectangle normalized to 0-1 page coordinates */
export type NormalizedRect = {
  x: number
  y: number
  w: number
  h: number
}

/** Section status: linked to nodes, explicitly skipped, or unmarked */
export type SectionStatus = 'linked' | 'skipped'

/** An excerpted section of a policy document */
export type PolicySection = {
  id: string
  documentId: string
  label: string
  text: string
  /** PDF page number where this section was captured from */
  page?: number
  /** Bounding boxes of the selected text on the PDF page (normalized 0-1) */
  rects?: NormalizedRect[]
  /** Whether this section is skipped/not-implementing */
  status?: SectionStatus
}

/** A mapping from a node path to a policy section (many-to-many) */
export type PolicyMapping = {
  nodePath: string
  sectionId: string
}

/** The full references manifest for a ruleset */
export type PolicyReferences = {
  documents: PolicyDocument[]
  sections: PolicySection[]
  mappings: PolicyMapping[]
}

/** A resolved reference with full section text and parent document info */
export type ResolvedReference = {
  section: PolicySection
  document: PolicyDocument
}
