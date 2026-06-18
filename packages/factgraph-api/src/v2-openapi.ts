/**
 * v2 Eligibility API — the engine-shaped contract (implemented).
 *
 * This is the spec for the surface served at `/v2/eligibility`, and it matches
 * what the endpoint actually does. The rules engine is the source of truth:
 * the request carries friendly, named fields (no Fact Graph paths, no
 * wildcards), one determination call serves every program, and nothing
 * applicant-material is defaulted — anything needed-but-absent comes back as
 * `pending` with the exact fields to fill, in the same friendly vocabulary.
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

export const V2_API_VERSION = '2.0.0'

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
      id: z.string().openapi({ description: 'Caller-assigned id; echoed as memberId on member-scoped determinations and used by reference fields (spouseId, etc.).' }),
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

  const DeterminationRequest = registry.register(
    'DeterminationRequest',
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Opaque; echoed back, never inspected.' }),
      programs: z.array(z.string()).optional().openapi({ description: 'Programs to evaluate (e.g. ["snap","medicaid"]). Omit to run every supported program.' }),
      asOf: z.string().optional().openapi({ format: 'date', description: 'Evaluation date; defaults to now.' }),
      household: z.object({}).passthrough().optional().openapi({ description: 'Household/application-level fields (per catalog).' }),
      members: z.array(Member).optional(),
      caregiverRelationships: z.array(CaregiverRelationship).optional(),
    }).openapi({
      description:
        'One household payload for every program. Everything is optional but a member `id`; an empty body is valid and returns every program pending with the inputs it needs.',
    })
  )

  // ---- response ------------------------------------------------------------

  const MissingInput = registry.register(
    'MissingInput',
    z.object({
      requestPath: z.string().openapi({ example: 'members[].isPregnant', description: 'Where to set the value in the request.' }),
      field: z.string(),
      location: z.string().openapi({ example: 'members[]' }),
      type: z.string().openapi({ example: 'Boolean' }),
      label: z.string().openapi({ description: "The rule author's display name." }),
      options: z.array(z.string()).optional().openapi({ description: 'Allowed values when the field is an enum.' }),
    }).openapi({ description: 'An input that would unlock or refine this determination, in the request vocabulary.' })
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
      status: z.enum(['approved', 'denied', 'ineligible', 'pending', 'not_supported']),
      path: z.enum(['auto', 'manual']).optional().openapi({ description: 'auto = decided by the rules; manual reserved for caseworker-verified determinations.' }),
      benefitAmount: z.number().optional().openapi({ description: 'Monthly benefit when approved (SNAP allotment).' }),
      proratedFirstMonthAmount: z.number().optional(),
      isExpedited: z.boolean().optional().openapi({ description: 'SNAP: expedited processing also applies.' }),
      medicaidCategory: z.string().optional(),
      chpEligible: z.boolean().optional(),
      denialReasonCode: z.string().optional().openapi({ description: 'snake_case; present on denied/ineligible.' }),
      explanation: z.array(ExplanationStep).optional().openapi({ description: 'Path-free "why" for denials.' }),
      missingInputs: z.array(MissingInput).optional().openapi({ description: 'Present when pending: exactly which fields to fill.' }),
      notes: z.array(z.string()).optional().openapi({ description: 'Assumptions/translation notes.' }),
    }).openapi({ description: 'One program decision. One shape for household- and member-scoped programs (no oneOf).' })
  )

  const DeterminationResponse = registry.register(
    'DeterminationResponse',
    z.object({
      metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Echoed from the request when present.' }),
      asOf: z.string().openapi({ format: 'date' }),
      determinations: z.array(Determination),
    }).openapi({ description: 'One unified response for every requested program.' })
  )

  registry.registerPath({
    method: 'post',
    path: '/v2/eligibility/evaluate/determination',
    summary: 'Eligibility determination (engine-shaped, no-guess).',
    description:
      `One household payload plus a list of programs, returning a determination per program — household-scoped for SNAP, one per member for Medicaid. Nothing applicant-material is defaulted: anything needed-but-absent yields status \`pending\` and \`missingInputs\` listing the exact fields to fill, in this same request vocabulary. Field definitions and enum vocabularies: ${CATALOG_URL}.`,
    tags: ['Eligibility v2'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: DeterminationRequest,
            examples: {
              'one household, both programs': {
                value: {
                  metadata: { caseId: 'abc-123' },
                  programs: ['snap', 'medicaid'],
                  members: [
                    {
                      id: 'head',
                      dateOfBirth: '1990-03-15',
                      citizenshipImmigrationStatus: 'citizen',
                      isHeadOfHousehold: true,
                      income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
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
        description: 'The unified determinations[] — one entry per requested program (per member for Medicaid).',
        content: { 'application/json': { schema: DeterminationResponse } },
      },
      400: { description: 'Invalid request.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
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
        '- **One call, every program** — one household payload + `programs[]` → a unified `determinations[]` (household-scoped for SNAP, one per member for Medicaid).',
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
