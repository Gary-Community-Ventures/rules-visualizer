/**
 * v2 Eligibility API — the engine-shaped contract (implemented).
 *
 * This is the spec for the surface served at `/v2/eligibility`. The rules
 * engine is the source of truth: the request carries friendly named fields
 * (no Fact Graph paths, no wildcards), separate endpoints per program give
 * each program an explicit, traceable boundary, and nothing applicant-material
 * is defaulted — anything needed-but-absent comes back as `pending` with the
 * exact fields to fill, in the same friendly vocabulary.
 *
 * The exhaustive field list (every input, its type, enum vocabulary, and
 * policy citation) is the generated catalog at docs/engine-inputs.json — this
 * spec documents the request/response *shape* and points there for fields, so
 * the two can't drift.
 */
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export const V2_API_VERSION = '1.0.0'

const CATALOG_URL =
  'https://gary-community-ventures.github.io/rules-visualizer/engine-inputs.html'

export function buildV2OpenApiDocument() {
  const registry = new OpenAPIRegistry()

  const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  })

  const ProblemDetails = registry.register(
    'ProblemDetails',
    z.object({
      type: z.string(),
      title: z.string(),
      status: z.number().int(),
      detail: z.string().optional(),
    }).openapi({ description: 'RFC 9457 Problem Details.' })
  )

  // ---- request -------------------------------------------------------------
  // Each collection row / the household / each member is a bag of friendly
  // fields. The fields themselves are enumerated in the catalog; the schema
  // documents the structure + the always-present handles and stays open
  // (additionalProperties) for the rest so it can't drift from the rules.

  const IncomeRow = registry.register(
    'IncomeRow',
    z.object({
      id: z.string().optional().openapi({ description: 'Caller handle for response correlation.' }),
      type: z.string().optional().openapi({ description: 'snake_case income source (e.g. wages_and_salaries, ssi). See catalog.' }),
      amount: z.number().optional(),
      frequency: z.string().optional().openapi({ description: 'snake_case e.g. monthly, weekly, annual.' }),
    }).passthrough().openapi({ description: 'One income source for the member it nests under.' })
  )
  const Row = (name: string, desc: string) =>
    registry.register(
      name,
      z.object({ id: z.string().optional() }).passthrough().openapi({ description: desc })
    )
  const ExpenseRow = Row('ExpenseRow', 'One expense for the member it nests under (fields per catalog).')
  const JobRow = Row('JobRow', 'One job for the member it nests under (fields per catalog).')
  const AssetRow = Row('AssetRow', 'One asset for the member it nests under (fields per catalog).')

  const Member = registry.register(
    'Member',
    z.object({
      id: z.string().optional().openapi({ description: 'Caller-assigned id; echoed as memberId on member-scoped determinations, used to key missingInputsByMember, and referenced by reference fields (spouseId, etc.). Strongly recommended — when absent, the member is addressed by the positional fallback `member-N`. Duplicate ids are rejected with a 400.' }),
      dateOfBirth: z.string().optional().openapi({ format: 'date', description: 'The engine derives age from this.' }),
      citizenshipImmigrationStatus: z.string().optional().openapi({ description: 'snake_case enum; see catalog.' }),
      income: z.array(IncomeRow).optional(),
      expenses: z.array(ExpenseRow).optional(),
      jobs: z.array(JobRow).optional(),
      assets: z.array(AssetRow).optional(),
    }).passthrough().openapi({
      description:
        `A household member. The fields shown are the common/derived ones; the full set of member fields is in the catalog (${CATALOG_URL}). Unknown fields are ignored with a warning; absent fields are never guessed.`,
    })
  )

  const CaregiverRelationship = registry.register(
    'CaregiverRelationship',
    z.object({
      caregiverId: z.string().optional().openapi({ description: "A member's id." }),
      dependentId: z.string().optional().openapi({ description: "A member's id." }),
    }).passthrough().openapi({ description: 'A caregiver→dependent link between two members (fields per catalog).' })
  )

  const HouseholdRequest = registry.register(
    'HouseholdRequest',
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Opaque; echoed back, never inspected.' }),
      asOf: z.string().optional().openapi({ format: 'date', description: 'Evaluation date; defaults to now.' }),
      missingInputsFormat: z.enum(['fields', 'instanced']).optional().openapi({
        description:
          'EXPERIMENTAL — under evaluation with integrators; may change or become the default. `"instanced"` switches `missingInputs` to one entry per concrete instance (each with an `at` hop-chain address and a `kind`), including `unacknowledged` entries for unanswered collection questions. Default `"fields"` is the current deduped-per-field shape. `missingInputsByMember` is attached unchanged in both formats during the evaluation window. Determination endpoints only; ignored by expedited screening.',
      }),
      household: z.object({}).passthrough().optional().openapi({ description: 'Household/application-level fields (per catalog).' }),
      members: z.array(Member).optional(),
      caregiverRelationships: z.array(CaregiverRelationship).optional(),
    }).openapi({
      description:
        'One household payload. Everything is optional; an empty body is valid and returns the program pending with the inputs it needs.',
    })
  )

  // ---- response ------------------------------------------------------------

  const InstanceHop = registry.register(
    'InstanceHop',
    z.object({
      in: z.string().openapi({ example: 'income', description: 'Request-vocabulary collection key: members, income, expenses, jobs, assets, caregiverRelationships.' }),
      id: z.string().openapi({ example: 'alice-income-0', description: 'The caller-assigned row id (positional fallback when the row had none).' }),
    }).openapi({ description: 'EXPERIMENTAL — one hop of an instance address: which collection, which row.' })
  )

  const MissingInput = registry.register(
    'MissingInput',
    z.object({
      kind: z.enum(['field', 'unacknowledged']).optional().openapi({
        description:
          'EXPERIMENTAL — present when the request opted into `missingInputsFormat: "instanced"`. `field`: a concrete value is missing at `at`. `unacknowledged`: a whole collection question is unanswered at `at` — answer with rows, or [] for none.',
      }),
      requestPath: z.string().openapi({ example: 'members[].isPregnant', description: 'Where to set the value in the request.' }),
      field: z.string(),
      location: z.string().optional().openapi({ example: 'members[]', description: 'Omitted on `unacknowledged` entries.' }),
      type: z.string().optional().openapi({ example: 'Boolean', description: 'Omitted on `unacknowledged` entries.' }),
      label: z.string().optional().openapi({ description: "The rule author's display name. Omitted on `unacknowledged` entries." }),
      options: z.array(z.string()).optional().openapi({ description: 'Allowed values when the field is an enum.' }),
      at: z.array(InstanceHop).optional().openapi({
        description:
          'EXPERIMENTAL (instanced format only) — the instance address: ordered hops from the request root down to the row that owes the value. Empty = household-level. Household = 0 hops, member = 1, sub-collection row = 2.',
      }),
      memberId: z.string().optional().openapi({
        description: 'Instanced format only: echo of `at[0].id` when the first hop is members — convenience for groupBy-by-member consumers.',
      }),
      hint: z.string().optional().openapi({
        description: 'On `unacknowledged` entries: how to answer the collection question.',
      }),
    }).openapi({
      description:
        'An input that would unlock or refine this determination, in the request vocabulary. Default format: one deduped entry per field (`location`/`type`/`label` always present). With `missingInputsFormat: "instanced"`: one entry per concrete instance, each carrying an `at` hop-chain address, plus `unacknowledged` entries for unanswered collection questions — an empty request\'s first missing input is literally `{field: "members", at: []}`.',
    })
  )

  const ExplanationStep = registry.register(
    'ExplanationStep',
    z.object({ factor: z.string(), outcome: z.unknown() }).openapi({ description: 'One factor in a path-free "why".' })
  )

  const Determination = registry.register(
    'Determination',
    z.object({
      program: z.string(),
      scope: z.enum(['household', 'member']).openapi({ description: 'household (SNAP) or member (Medicaid, one per member).' }),
      memberId: z.string().optional().openapi({ description: 'Set when scope is member — the caller-assigned member id.' }),
      status: z.enum(['approved', 'denied', 'ineligible', 'pending']),
      path: z.enum(['auto', 'manual']).optional().openapi({ description: 'auto = decided by the rules; manual reserved for caseworker-verified determinations.' }),
      benefitAmount: z.number().optional().openapi({ description: 'Monthly benefit when approved (SNAP allotment).' }),
      proratedFirstMonthAmount: z.number().optional(),
      isExpedited: z.boolean().optional().openapi({ description: 'SNAP: expedited processing also applies.' }),
      medicaidCategory: z.string().optional().openapi({ description: 'snake_case MAGI category (e.g. adult, infant, older_child, ssi_recipient, ineligible).' }),
      chpEligible: z.boolean().optional(),
      denialReasonCode: z.string().optional().openapi({ description: 'snake_case; present on denied/ineligible.' }),
      explanation: z.array(ExplanationStep).optional().openapi({ description: 'Path-free "why" for denials.' }),
      missingInputs: z.array(MissingInput).optional().openapi({ description: 'Present whenever needed inputs remain unfilled (always when pending; may also accompany a decided status when side outputs such as the benefit amount could not resolve): exactly which fields to fill. On member-scoped determinations (medicaid) this is that member\'s own gaps plus the shared household-level gaps; on household-scoped determinations (SNAP) it is the union across members.' }),
      missingInputsByMember: z.record(z.string(), z.array(MissingInput)).optional().openapi({ description: 'Household-scoped determinations (SNAP) only: the member-level subset of missingInputs keyed by member id. Shared inputs (income rows, expenses) appear only in the top-level missingInputs. Member-scoped determinations carry their member\'s gaps directly in missingInputs instead.' }),
      notes: z.array(z.string()).optional().openapi({ description: 'Assumptions/translation notes.' }),
    }).openapi({ description: 'One program decision. One shape for household- and member-scoped programs (no oneOf).' })
  )

  const DeterminationResponse = registry.register(
    'DeterminationResponse',
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Echoed from the request when present.' }),
      asOf: z.string().openapi({ format: 'date' }),
      determinations: z.array(Determination),
    }).openapi({ description: 'Program determination response.' })
  )

  const ExpeditedScreeningResponse = registry.register(
    'ExpeditedScreeningResponse',
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Echoed from the request when present.' }),
      asOf: z.string().openapi({ format: 'date' }),
      isExpedited: z.boolean().nullable().openapi({
        description: 'true = qualifies for expedited processing; false = does not; null = inputs insufficient to screen.',
      }),
      missingInputs: z.array(MissingInput).optional().openapi({
        description: 'Present when isExpedited is null — the inputs needed to complete the screen.',
      }),
      notes: z.array(z.string()).optional().openapi({ description: 'Translation warnings, if any.' }),
    }).openapi({ description: 'Expedited screening result. isExpedited is null when inputs are insufficient to resolve the screen.' })
  )

  const commonResponses = {
    400: { description: 'Invalid request (malformed JSON, bad field shapes, duplicate member ids, invalid asOf).', content: { 'application/json': { schema: ProblemDetails } } },
    401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
    413: { description: 'Request body over the 10 MB limit.', content: { 'application/json': { schema: ProblemDetails } } },
    500: { description: 'Evaluation failed server-side. Not caused by your input; safe to retry after the fault is fixed.', content: { 'application/json': { schema: ProblemDetails } } },
    503: { description: 'The ruleset for this program is not loaded (server starting or misconfigured). Retry later.', content: { 'application/json': { schema: ProblemDetails } } },
  }

  // Examples use each program's own catalog vocabulary — the SNAP member
  // fields (citizenshipImmigrationStatus, isHeadOfHousehold, …) and the
  // medicaid ones (immigrantStatus, disabled, …) are different field sets.
  const exampleSnapMember = {
    id: 'head',
    dateOfBirth: '1990-03-15',
    citizenshipImmigrationStatus: 'citizen',
    isHeadOfHousehold: true,
    income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
  }
  const exampleMedicaidMember = {
    id: 'head',
    dateOfBirth: '1990-03-15',
    immigrantStatus: 'citizen',
    disabled: false,
    income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
  }

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/snap/determination',
    summary: 'SNAP eligibility determination (no-guess).',
    description:
      `One household payload; returns a single household-scoped determination. Nothing applicant-material is defaulted: anything needed-but-absent yields status \`pending\` and \`missingInputs\` listing the exact fields to fill, in this same request vocabulary. Expedited screening is included in the response (\`isExpedited\`). Field definitions and enum vocabularies: ${CATALOG_URL}.`,
    tags: ['Eligibility v2'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: HouseholdRequest,
            examples: {
              'single member household': {
                value: { metadata: { caseId: 'abc-123' }, members: [exampleSnapMember] },
              },
            },
          } as never,
        },
      },
    },
    responses: {
      200: {
        description: 'A single household-scoped determination.',
        content: { 'application/json': { schema: DeterminationResponse } },
      },
      ...commonResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/snap/expedited-screening',
    summary: 'SNAP expedited processing screen (7 CFR §273.2(i)).',
    description:
      'Screens whether the household qualifies for expedited processing (benefits within 7 days). Same no-guess semantics as the full determination: `isExpedited` is null when the screen cannot resolve, and `missingInputs` names exactly what to provide. The missing-input list reflects the full transitive dependency of the expedited screen — provide income and household fields to resolve it.',
    tags: ['Eligibility v2'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: HouseholdRequest,
            examples: {
              'destitute household': {
                value: {
                  metadata: { caseId: 'abc-123' },
                  members: [
                    {
                      id: 'head',
                      dateOfBirth: '1990-03-15',
                      citizenshipImmigrationStatus: 'citizen',
                      isHeadOfHousehold: true,
                      income: [{ type: 'wages_and_salaries', amount: 0, frequency: 'monthly' }],
                    },
                  ],
                },
              },
            },
          } as never,
        },
      },
    },
    responses: {
      200: {
        description: 'Expedited screening result.',
        content: { 'application/json': { schema: ExpeditedScreeningResponse } },
      },
      ...commonResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/medicaid/determination',
    summary: 'Medicaid eligibility determination (no-guess, per member).',
    description:
      `One household payload; returns one member-scoped determination per household member. Nothing applicant-material is defaulted: anything needed-but-absent yields status \`pending\` and \`missingInputs\` attributed to that specific member. Field definitions and enum vocabularies: ${CATALOG_URL}.`,
    tags: ['Eligibility v2'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: HouseholdRequest,
            examples: {
              'two-member household': {
                value: {
                  metadata: { caseId: 'abc-123' },
                  members: [
                    exampleMedicaidMember,
                    { id: 'spouse', dateOfBirth: '1992-07-20', immigrantStatus: 'citizen' },
                  ],
                },
              },
            },
          } as never,
        },
      },
    },
    responses: {
      200: {
        description: 'One member-scoped determination per household member.',
        content: { 'application/json': { schema: DeterminationResponse } },
      },
      ...commonResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/medicaid/ex-parte',
    summary: 'Medicaid ex-parte renewal (not yet implemented).',
    description:
      'Reserved for the ex-parte renewal flow. Currently responds 501 with a pointer to the v1 surface.',
    tags: ['Eligibility v2'],
    security: [{ [bearerAuth.name]: [] }],
    request: {},
    responses: {
      501: {
        description: 'Not yet implemented.',
        content: { 'application/json': { schema: ProblemDetails } },
      },
      401: commonResponses[401],
    },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Eligibility API — v2 (engine-shaped)',
      version: V2_API_VERSION,
      description: [
        'The engine-shaped eligibility contract served at `/v2/eligibility`. The rules engine is the source of truth; build your data model to match these fields.',
        '',
        '- **Friendly fields, no internals** — named fields in nested collections (`members[].income[]`), snake_case enums, no Fact Graph paths or wildcards.',
        '- **Per-program endpoints** — `/snap/determination` (household-scoped) and `/medicaid/determination` (one determination per member), explicit and independently traceable.',
        '- **No-guess** — nothing applicant-material is defaulted; what is missing comes back as `pending` + `missingInputs`, in the same request vocabulary, so you know exactly what to send next.',
        '',
        `**Every field** — its type, enum vocabulary, and policy citation — is in the generated catalog: ${CATALOG_URL} (machine-readable JSON alongside it). This spec documents the request/response shape; the catalog is the field list, so they cannot drift.`,
      ].join('\n'),
      license: { name: 'MPL-2.0' },
    },
    servers: [
      { url: 'https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com', description: 'Production' },
      { url: 'http://localhost:5002', description: 'Local dev' },
    ],
    tags: [{ name: 'Eligibility v2', description: 'Engine-shaped eligibility determination.' }],
  })
}
