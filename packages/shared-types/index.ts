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

export type RacCitation = {
  source: string
  type: string // usually 'restates'
  authority?: string // 'federal', 'state', etc.
  fromModule?: string // jurisdiction-prefixed module id, e.g. 'us-co:regulations/10-ccr-2506-1/4.207.3'
}

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
  // RuleSpec-only fields. None are populated by the old .rac parser, so
  // factgraph/rendering of legacy content is unaffected.
  /** The RuleSpec value type — Money, Judgment, Integer, Rate, etc. */
  dtype?: string
  /** Temporal grain — usually Month / Day / Year. */
  period?: string
  /** Which variable indexes a parameter-table value lookup, e.g. household_size. */
  indexedBy?: string
  /** Parameter-table data (e.g. {"1": 298, "2": 546, ...}). When set, this
   *  variable's "value" is a lookup table; `expression` is typically empty. */
  valueTable?: Record<string, unknown>
  /** Free-text summary of the regulation module this rule belongs to —
   *  RuleSpec's closest analogue to per-rule documentation. */
  moduleSummary?: string
  /** Cross-rule provenance: other regulations that restate or refine this
   *  one (populated from `source_relation` rules in imported modules). */
  citations?: RacCitation[]
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
  /** Static Enum option values (when the target fact's EnumOptions are
   *  simple <String value="..."/> children). Unset if the options are
   *  conditional or can't be resolved statically. */
  enumOptions?: string[]
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
  /** When dataType is 'Enum', the path to the EnumOptions fact —
   *  set so the FE can show an enum dropdown when overriding. */
  enumOptionsPath?: string
  /** Static Enum option values resolved from the EnumOptions target,
   *  same shape as FactGraphWritable.enumOptions. */
  enumOptions?: string[]
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
  /** Optional human-readable note the user can attach (e.g. "Earned income
   *  exclusion clause"). Sections start without one and the user adds it
   *  later via the popover. Empty/missing is a valid state. */
  comment?: string
  /** PDF page number where this section was captured from */
  page?: number
  /** Bounding boxes on the PDF page (normalized 0-1). With the box-draw
   *  capture model this is exactly one rect; visual previews are rendered
   *  from the PDF directly. */
  rects?: NormalizedRect[]
  /** Text extracted from inside the captured box at save time. Stored so
   *  the AI tools can include the policy excerpt without re-loading the
   *  PDF. Snapshot — won't auto-update if the underlying PDF changes. */
  text: string
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
