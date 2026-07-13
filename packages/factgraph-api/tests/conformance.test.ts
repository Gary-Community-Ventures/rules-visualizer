/**
 * Response-vs-spec conformance.
 *
 * The snapshot tests prove the committed specs are FRESH (byte-equal to the
 * generators); this proves they are TRUE: live responses from a battery of
 * representative requests across all three surfaces are validated against
 * the served OpenAPI schemas with ajv (OpenAPI 3.1 = JSON Schema 2020-12).
 * A route that adds, renames, or mistypes a response field the spec doesn't
 * document — or a spec that requires a field routes don't send — fails here.
 *
 * Scope: the spec schemas don't declare `additionalProperties: false`, so
 * this catches missing-required fields and wrong types, not undocumented
 * extras. Wire-shape strictness beyond that lives in the per-route tests.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { app } from './helpers.js'
import { buildFriendlyRequest } from './snap-golden-fixture.js'
import { buildV2OpenApiDocument } from '../src/v2-openapi.js'
import { buildConsumerOpenApiDocument } from '../src/consumer-openapi.js'
import { buildOpenApiDocument } from '../src/openapi.js'

// One ajv instance per spec document; strict: false because OpenAPI documents
// carry non-JSON-Schema keywords (example, tags, paths, …) that ajv would
// otherwise reject while compiling reachable schemas.
function validatorFor(doc: unknown) {
  const ajv = new (Ajv2020 as unknown as typeof import('ajv/dist/2020.js').default)({
    strict: false,
    allowUnionTypes: true,
  })
  addFormats(ajv as never)
  ajv.addSchema(doc as object, 'spec')
  return (pointer: string, payload: unknown): void => {
    const validate = ajv.getSchema(`spec#/components/schemas/${pointer}`)
    assert.ok(validate, `spec has a schema named ${pointer}`)
    const ok = validate!(payload)
    assert.ok(
      ok,
      `response does not conform to ${pointer}:\n` +
        JSON.stringify(validate!.errors, null, 2) +
        '\npayload: ' +
        JSON.stringify(payload).slice(0, 800)
    )
  }
}

const ANSWERED_ADULT = {
  id: 'alice',
  dateOfBirth: '1990-03-15',
  pregnant: 0,
  pregnancyEndDate: '2000-01-01',
  receivesSsi: false,
  disabled: false,
  veteran: false,
  hasDisabledChild: false,
  isFullTimeStudent: false,
  monthlyHoursWorked: 80,
  immigrantStatus: 'citizen',
  income: [{ id: 'pay-1', type: 'wages_and_salaries', amount: 500, frequency: 'monthly' }],
}

test('v2 surface: every representative response conforms to the served spec', async () => {
  const check = validatorFor(buildV2OpenApiDocument())

  const cases: Array<[string, unknown, number, string]> = [
    // [url, body, expected status, schema]
    ['/v2/eligibility/snap/determination', {}, 200, 'DeterminationResponse'],
    ['/v2/eligibility/snap/determination', buildFriendlyRequest(), 200, 'DeterminationResponse'],
    ['/v2/eligibility/snap/determination', buildFriendlyRequest({ incomeAmount: 99999 }), 200, 'DeterminationResponse'],
    // partial household: member-level gaps + unacknowledged collections
    ['/v2/eligibility/snap/determination', { members: [{ id: 'a', dateOfBirth: '1990-01-01' }, { id: 'b' }] }, 200, 'DeterminationResponse'],
    // deprecated-flag note path
    ['/v2/eligibility/snap/determination', { missingInputsFormat: 'fields', members: [{ id: 'a' }] }, 200, 'DeterminationResponse'],
    ['/v2/eligibility/medicaid/determination', {}, 200, 'DeterminationResponse'],
    ['/v2/eligibility/medicaid/determination', { members: [ANSWERED_ADULT] }, 200, 'DeterminationResponse'],
    // mixed: answered + thin member (finality-gate pending)
    ['/v2/eligibility/medicaid/determination', { members: [ANSWERED_ADULT, { id: 'bob', income: [] }] }, 200, 'DeterminationResponse'],
    ['/v2/eligibility/snap/expedited-screening', {}, 200, 'ExpeditedScreeningResponse'],
    ['/v2/eligibility/snap/expedited-screening', { members: [{ id: 'a', income: [] }] }, 200, 'ExpeditedScreeningResponse'],
    // validation and routing errors
    ['/v2/eligibility/snap/determination', { members: [{ id: 'a' }, { id: 'a' }] }, 400, 'ProblemDetails'],
    ['/v2/eligibility/snap/determination', { asOf: '2026-02-30', members: [{ id: 'a' }] }, 400, 'ProblemDetails'],
    ['/v2/eligibility/tanf/determination', {}, 404, 'ProblemDetails'],
    ['/v2/eligibility/medicaid/ex-parte', {}, 501, 'ProblemDetails'],
  ]

  for (const [url, body, status, schema] of cases) {
    const res = await request(app).post(url).send(body as object)
    assert.equal(res.status, status, `${url} → ${res.status}, expected ${status}: ${JSON.stringify(res.body).slice(0, 300)}`)
    check(schema, res.body)
  }
})

test('advanced /query surface: responses conform, including traces and instances', async () => {
  const check = validatorFor(buildOpenApiDocument())
  const url = '/v1/factgraph/snap-complete/query'

  // Empty intake: the full missing-inputs shape.
  const intake = await request(app)
    .post(url)
    .send({ targets: ['/eligibilityCategory'], include: ['missingInputInstances'] })
  assert.equal(intake.status, 200)
  check('QueryResponse', intake.body)

  // Per-member target with every opt-in section: supportingFacts, recursive
  // traces (PerMember + CollectionRead nodes), decidingPaths, metadata echo.
  const perMember = await request(app)
    .post('/v1/factgraph/snap-fy2026/query')
    .send({
      targets: ['/members/*/meetsStudentAgeException', '/eligible'],
      include: ['trace', 'supportingFacts', 'missingInputInstances'],
      metadata: { probe: true },
      inputs: {
        '/grossEarnedIncome': 0,
        '/members': [{ id: 'applicant', '/members/*/age': 70 }],
      },
    })
  assert.equal(perMember.status, 200)
  check('QueryResponse', perMember.body)

  // Errors: unknown target (404), invalid body (400 with errors[]).
  const unknown = await request(app).post(url).send({ targets: ['/nope'] })
  assert.equal(unknown.status, 404)
  check('ProblemDetails', unknown.body)

  const invalid = await request(app).post(url).send({ targets: [] })
  assert.equal(invalid.status, 400)
  check('ProblemDetails', invalid.body)
})

test('v1 consumer surface: responses conform to the frozen adapter contract', async () => {
  const check = validatorFor(buildConsumerOpenApiDocument())

  const snap = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send({
      metadata: { caseId: 'conf-1' },
      program: 'snap',
      household: { size: 1 },
      members: [{ dateOfBirth: '1990-03-15', income: [{ amount: 1200, frequency: 'monthly' }] }],
    })
  assert.equal(snap.status, 200)
  check('ProgramDecision', snap.body)

  const medicaid = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send({
      metadata: { caseId: 'conf-2' },
      program: 'medicaid',
      household: {},
      members: [{ dateOfBirth: '1990-03-15', income: [{ amount: 500, frequency: 'monthly' }] }],
    })
  assert.equal(medicaid.status, 200)
  check('MedicaidDeterminationResponse', medicaid.body)

  const expedited = await request(app)
    .post('/v1/eligibility/evaluate/expedited-screening')
    .send({ metadata: {}, household: {} })
  assert.equal(expedited.status, 200)
  check('ExpeditedScreeningResponse', expedited.body)

  const unimplemented = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send({ metadata: {}, program: 'chip', household: {}, members: [{}] })
  assert.equal(unimplemented.status, 501)
  check('ProblemDetails', unimplemented.body)

  const bad = await request(app)
    .post('/v1/eligibility/evaluate/determination')
    .send({ program: 'snap' })
  assert.equal(bad.status, 400)
  check('ProblemDetails', bad.body)
})

test('negative control: the validator itself rejects malformed payloads', () => {
  // Guards the guard — if ajv ever silently fails to resolve the spec refs,
  // the three tests above would pass vacuously. Prove rejection works.
  const ajv = new (Ajv2020 as unknown as typeof import('ajv/dist/2020.js').default)({
    strict: false,
    allowUnionTypes: true,
  })
  addFormats(ajv as never)
  ajv.addSchema(buildV2OpenApiDocument() as object, 'spec')
  const v = ajv.getSchema('spec#/components/schemas/DeterminationResponse')!
  assert.equal(v({ determinations: [] }), false, 'missing required asOf must fail')
  assert.equal(
    v({ asOf: '2026-07-13', determinations: [{ program: 'snap', scope: 'household', status: 'pending', missingInputs: [{ requestPath: 'x', field: 'x' }] }] }),
    false,
    'a missingInputs entry without kind/at must fail'
  )
  assert.equal(
    v({ asOf: '2026-07-13', determinations: [{ program: 'snap', scope: 'household', status: 'approved', benefitAmount: 'lots' }] }),
    false,
    'a string benefitAmount must fail'
  )
  assert.equal(
    v({ asOf: '2026-07-13', determinations: [{ program: 'snap', scope: 'household', status: 'not_supported' }] }),
    false,
    'the retired not_supported enum value must fail'
  )
})
