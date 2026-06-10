/**
 * Consumer-facing OpenAPI 3.1 document for the eligibility adapter.
 *
 * This is the SEPARATE consumer contract the partner asked for: only the
 * domain-oriented `/v1/eligibility/evaluate/*` endpoints, shaped around the
 * ORCA model, with **no Fact Graph paths, targets, or traces** anywhere.
 * The advanced/tooling surface (generic Fact Graph query + discovery) is a
 * different document — see `openapi.ts`.
 *
 * Conventions follow the Worker Portal team's conventions guide and the
 * blueprint `eligibility-adapter-openapi.yaml`: kebab-case paths, snake_case enum and
 * reason-code values, PascalCase schema names, camelCase properties,
 * `metadata` echoed unchanged, `pending | approved | denied | ineligible`
 * decision status. Served at `/v1/eligibility/openapi.{json,yaml}` + `/docs`.
 */
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export const CONSUMER_API_VERSION = '0.1.0'

// ORCA enum value sets (snake_case), mirrored from the blueprint schemas.
const CITIZENSHIP = ['us_citizen', 'us_national', 'non_citizen'] as const
const IMMIGRATION = [
  'lawful_permanent_resident', 'refugee', 'asylee', 'deportation_withheld',
  'parolee', 'conditional_entrant', 'cuban_haitian_entrant', 'amerasian',
  'battered_non_citizen', 'trafficking_victim', 'temporary_protected_status', 'other',
] as const
const RELATIONSHIP = [
  'head_of_household', 'spouse', 'partner', 'child', 'parent', 'sibling',
  'grandparent', 'grandchild', 'other_relative', 'non_relative',
] as const
const INCOME_TYPE = ['employed', 'self_employed', 'unearned'] as const
const INCOME_BASIS = ['net', 'gross'] as const
const FREQUENCY = [
  'hourly', 'daily', 'weekly', 'every_2_weeks', 'twice_a_month', 'monthly', 'yearly',
] as const
const EXPENSE_CATEGORY = [
  'housing', 'utilities', 'childcare', 'medical', 'dependent_care',
  'child_support_paid', 'other',
] as const
const ASSET_TYPE = [
  'liquid', 'vehicle', 'real_property', 'retirement_account', 'life_insurance', 'other',
] as const
const PROGRAM = ['snap', 'medicaid', 'chip', 'tanf', 'ccdf'] as const
const STATUS = ['pending', 'approved', 'denied', 'ineligible'] as const

/** A full representative request — the partner asked for examples, and this
 *  doubles as "here is everything the determination can use". Fields beyond
 *  id/dateOfBirth are optional; absent ones are defaulted and disclosed in
 *  x-translationNotes, or surfaced in x-missingInformation. */
const HOUSEHOLD_EXAMPLE = {
  metadata: { intake: { applicationId: 'app-123' }, eligibility: { caseId: 'case-456' } },
  program: 'snap',
  household: { size: 2, housingCosts: 800, utilityCosts: 150, isMigrantOrSeasonalFarmWorker: false },
  members: [
    {
      id: 'head',
      dateOfBirth: '1990-03-15',
      citizenshipStatus: 'us_citizen',
      relationshipToHead: 'head_of_household',
      isDisabled: false,
      programs: ['snap', 'medicaid'],
      income: [{ type: 'employed', amount: 1200, frequency: 'monthly', incomeBasis: 'gross' }],
      expenses: [{ category: 'housing', amount: 800, frequency: 'monthly' }],
      assets: [{ type: 'liquid', value: 500, description: 'checking account' }],
    },
    { id: 'child', dateOfBirth: '2020-01-01', citizenshipStatus: 'us_citizen', relationshipToHead: 'child' },
  ],
  verificationSummary: [],
}

export function buildConsumerOpenApiDocument() {
  const registry = new OpenAPIRegistry()

  const Income = registry.register(
    'Income',
    z.object({
      type: z.enum(INCOME_TYPE).openapi({ description: 'earned (employed/self_employed) vs unearned.' }),
      unearnedType: z.string().optional().openapi({
        description: 'Specific unearned source when type is unearned (e.g. ssi_or_ssdi, social_security_retirement, unemployment).',
      }),
      incomeBasis: z.enum(INCOME_BASIS).optional(),
      amount: z.number().openapi({ description: 'Amount for the given frequency period.' }),
      frequency: z.enum(FREQUENCY),
    }).openapi({ description: 'One income source for a member.' })
  )

  const Expense = registry.register(
    'Expense',
    z.object({
      category: z.enum(EXPENSE_CATEGORY),
      amount: z.number(),
      frequency: z.enum(FREQUENCY),
    }).openapi({ description: 'One expense for a member.' })
  )

  const Asset = registry.register(
    'Asset',
    z.object({
      type: z.enum(ASSET_TYPE),
      value: z.number().openapi({ description: 'Current fair-market value.' }),
      description: z.string().optional(),
    }).openapi({ description: 'One asset/resource for a member.' })
  )

  const Employment = registry.register(
    'Employment',
    z.object({
      status: z.string().optional().openapi({ description: 'full_time | part_time | seasonal | self_employed | not_employed.' }),
      hoursPerWeek: z.number().optional().openapi({ description: 'Used for SNAP work-requirement evaluation when present.' }),
    }).openapi({ description: 'One employment record (from the published contract). hoursPerWeek is consumed; other fields are accepted for compatibility.' })
  )

  const MemberContext = registry.register(
    'MemberContext',
    z.object({
      id: z.string().optional().openapi({ description: "Caller's correlation handle for this member, echoed on per-member results. Optional — the published contract's member has no id; absent ids fall back to positional member-N handles." }),
      dateOfBirth: z.string().optional().openapi({ format: 'date', example: '1990-03-15', description: 'Optional per the published contract; when absent, age is defaulted and the assumption disclosed in x-translationNotes.' }),
      citizenshipStatus: z.enum(CITIZENSHIP).optional(),
      immigrationStatus: z.enum(IMMIGRATION).optional().openapi({
        description: 'Present when citizenshipStatus is non_citizen.',
      }),
      relationshipToHead: z.enum(RELATIONSHIP).optional(),
      isDisabled: z.boolean().optional(),
      programs: z.array(z.enum(PROGRAM)).optional(),
      income: z.array(Income).optional(),
      expenses: z.array(Expense).optional(),
      assets: z.array(Asset).optional(),
      employment: z.array(Employment).optional(),
      healthCoverage: z.array(z.unknown()).optional().openapi({ description: 'Accepted for contract compatibility; not consumed by the SNAP/Medicaid rules today.' }),
    }).openapi({
      description: 'A household member: ORCA demographics plus income/expenses/assets/employment. No fields are required (matching the published contract); absent fields are defaulted (disclosed via x-translationNotes) or requested back via x-missingInformation.',
    })
  )

  const Household = registry.register(
    'Household',
    z.object({
      size: z.number().int().optional(),
      housingCosts: z.number().optional(),
      utilityCosts: z.number().optional(),
      isMigrantOrSeasonalFarmWorker: z.boolean().optional(),
    }).openapi({ description: 'Household-level data.' })
  )

  const metadata = z.record(z.string(), z.unknown()).openapi({
    description: 'Opaque correlation context. The adapter echoes it back unchanged and never inspects it.',
  })

  const HouseholdDeterminationRequest = registry.register(
    'HouseholdDeterminationRequest',
    z.object({
      metadata: metadata,
      program: z.enum(PROGRAM),
      household: Household,
      members: z.array(MemberContext).min(1),
      verificationSummary: z.array(z.unknown()).optional().openapi({
        description: 'Status of verification obligations (status enum: pending | inconclusive | satisfied | waived | cannot_verify).',
      }),
    }).openapi({ description: 'Determination request carrying the whole household. Used for SNAP and Medicaid. The published contract\'s per-applicant IndividualDeterminationRequest (single `member`) is also accepted for medicaid — the adapter wraps it as a household whose only known member is the applicant and discloses that assumption in x-translationNotes.', example: HOUSEHOLD_EXAMPLE as never })
  )

  const ExpeditedScreeningRequest = registry.register(
    'ExpeditedScreeningRequest',
    z.object({
      metadata: metadata,
      household: Household,
      members: z.array(MemberContext).optional().openapi({
        description: 'Overlay: member/income/resource context. The published contract is household-only, but its household object carries no income or liquid-resource fields, so without members the §273.2(i) comparison cannot be computed and the response is a conservative `expedited: false` with x-missingInformation.',
      }),
    }).openapi({ description: 'Expedited SNAP screening request (7 CFR §273.2(i)). Household-only requests (the contract-exact shape) are accepted.' })
  )

  // ---- Responses (path-free) ----

  const MissingInformation = registry.register(
    'MissingInformation',
    z.object({
      field: z.string().openapi({ description: 'Human field name still needed (never a Fact Graph path).' }),
      dataType: z.string().openapi({ example: 'Boolean' }),
      options: z.array(z.string()).optional().openapi({ description: 'Allowed values when the field is an enum.' }),
    }).openapi({ description: 'One piece of information still needed to reach a determination.' })
  )

  const ExplanationStep = registry.register(
    'ExplanationStep',
    z.object({
      factor: z.string().openapi({ description: 'Human-readable factor that drove the outcome.' }),
      outcome: z.unknown().openapi({ description: 'The factor’s value (e.g. true/false).' }),
    }).openapi({ description: 'One step of a path-free, domain-summarized explanation.' })
  )

  const ProgramDecision = registry.register(
    'ProgramDecision',
    z.object({
      metadata: metadata,
      program: z.enum(PROGRAM),
      status: z.enum(STATUS).openapi({
        description: 'approved · denied (failed a test — appeal rights) · ineligible (categorical bar) · pending (more information needed — see x-missingInformation).',
      }),
      path: z.enum(['auto', 'manual']).openapi({ description: 'auto — resolved by the rules engine.' }),
      denialReasonCode: z.string().optional().openapi({ description: 'snake_case reason code; present when denied/ineligible.', example: 'failed_gross_income_test' }),
      'x-allotment': z.number().optional().openapi({ description: 'SNAP: full-month allotment.' }),
      'x-proratedAllotment': z.number().optional().openapi({ description: 'SNAP: prorated first-month allotment.' }),
      'x-expedited': z.boolean().optional().openapi({ description: 'SNAP: whether expedited processing also applies.' }),
      'x-missingInformation': z.array(MissingInformation).optional(),
      'x-translationNotes': z.array(z.string()).optional().openapi({ description: 'Assumptions the determination is conditional on (defaulted fields, unmapped values).' }),
      'x-explanation': z.array(ExplanationStep).optional().openapi({ description: 'Path-free "why" for denials.' }),
    }).openapi({
      description: 'Decision for one household-level program (SNAP). Base fields are the contract; x- fields are additive overlays and never contain Fact Graph paths.',
    })
  )

  const MemberMedicaidDecision = registry.register(
    'MemberMedicaidDecision',
    z.object({
      memberId: z.string(),
      status: z.enum(STATUS),
      path: z.literal('auto'),
      denialReasonCode: z.string().optional(),
      'x-medicaidCategory': z.string().optional().openapi({ description: 'Infant | YoungChild | OlderChild | Adult | Pregnant | SsiRecipient | Ineligible.' }),
      'x-chpEligible': z.boolean().optional().openapi({ description: "Whether the member qualifies for CHP+ as an alternative." }),
    }).openapi({ description: 'One member-level medicaid decision.' })
  )

  const MedicaidDeterminationResponse = registry.register(
    'MedicaidDeterminationResponse',
    z.object({
      metadata: metadata,
      program: z.literal('medicaid'),
      decisions: z.array(MemberMedicaidDecision).openapi({
        description: 'One decision per member. Medicaid is household-in / per-member-out: each member’s eligibility depends on the whole household (size + income → FPL%).',
      }),
      'x-missingInformation': z.array(MissingInformation).optional(),
      'x-translationNotes': z.array(z.string()).optional(),
    }).openapi({ description: 'Medicaid determination — per-member decisions for the household.' })
  )

  const ExpeditedScreeningResponse = registry.register(
    'ExpeditedScreeningResponse',
    z.object({
      metadata: metadata,
      expedited: z.boolean(),
      'x-missingInformation': z.array(MissingInformation).optional().openapi({
        description: 'Present when the screen could not actually be computed from the supplied data — expedited is then a conservative false, and this lists what was missing.',
      }),
    }).openapi({ description: 'Response from expedited SNAP screening.' })
  )

  const ProblemDetails = registry.register(
    'ProblemDetails',
    z.object({
      type: z.string(),
      title: z.string(),
      status: z.number().int(),
      detail: z.string(),
    }).openapi({ description: 'RFC 9457 Problem Details error.' })
  )

  const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http', scheme: 'bearer',
    description: 'Required on every request when the deployed API has a bearer token configured.',
  })

  registry.registerPath({
    method: 'post',
    path: '/v1/eligibility/evaluate/determination',
    summary: 'Final eligibility determination for one program.',
    description: 'Send an ORCA-shaped household request; receive a decision. SNAP returns a single ProgramDecision for the household; Medicaid returns a MedicaidDeterminationResponse (one decision per member). chip/tanf/ccdf return 501. No Fact Graph paths appear in request or response.',
    tags: ['Eligibility'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: HouseholdDeterminationRequest } } } },
    responses: {
      200: {
        description: 'ProgramDecision (SNAP) or MedicaidDeterminationResponse (Medicaid).',
        content: { 'application/json': { schema: z.union([ProgramDecision, MedicaidDeterminationResponse]) } },
      },
      400: { description: 'Invalid or unknown program.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
      501: { description: 'Program recognized but not yet implemented.', content: { 'application/json': { schema: ProblemDetails } } },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v1/eligibility/evaluate/expedited-screening',
    summary: 'Expedited SNAP screening (7 CFR §273.2(i)).',
    tags: ['Eligibility'],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: ExpeditedScreeningRequest } } } },
    responses: {
      200: { description: 'Expedited screening result.', content: { 'application/json': { schema: ExpeditedScreeningResponse } } },
      400: { description: 'Invalid request.', content: { 'application/json': { schema: ProblemDetails } } },
      401: { description: 'Authentication required.', content: { 'application/json': { schema: ProblemDetails } } },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/v1/eligibility/evaluate/medicaid-ex-parte',
    summary: 'Medicaid ex parte evaluation (not yet implemented).',
    description: 'Reserved by the contract. Ex parte runs the same medicaid determination through a different evidentiary pathway (electronic checks + a conclusiveness gate); implementation awaits contract clarification of the electronic-check result schemas and household context for the per-applicant call. Returns 501.',
    tags: ['Eligibility'],
    security: [{ [bearerAuth.name]: [] }],
    responses: { 501: { description: 'Not implemented.', content: { 'application/json': { schema: ProblemDetails } } } },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Eligibility Adapter API',
      version: CONSUMER_API_VERSION,
      description: [
        'Consumer-facing eligibility determination API for the Worker Portal.',
        '',
        'Domain-oriented (ORCA-shaped) requests and responses. The caller never needs to know Fact Graph paths, targets, or traces — the rules engine owns all of that internally. Set your adapter base URL to `<host>/v1/eligibility` and the contract’s `/evaluate/...` tails resolve directly.',
      ].join('\n'),
      license: { name: 'MPL-2.0' },
    },
    servers: [
      { url: 'https://rules-visualizer-factgraph-api-f0c14673cf3a.herokuapp.com', description: 'Production' },
      { url: 'http://localhost:5002', description: 'Local dev' },
    ],
    tags: [{ name: 'Eligibility', description: 'Domain-oriented eligibility determination endpoints.' }],
  })
}
