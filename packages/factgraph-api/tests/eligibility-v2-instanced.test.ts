/**
 * Instanced missing-inputs — THE v2 missingInputs shape.
 *
 * Pins the two-address design: `requestPath` (schema address — which
 * question) + `at` (instance address — hop chain of {in, id} down to the
 * owing row), and the `unacknowledged` entry kind that makes the
 * rows-or-[] acknowledgment rule visible in the response, recursing to the
 * root for an empty request. The pre-instanced `missingInputsFormat` flag
 * is deprecated and ignored.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const SNAP_URL = '/v2/eligibility/snap/determination'
const MEDICAID_URL = '/v2/eligibility/medicaid/determination'

type Hop = { in: string; id: string }
type Entry = {
  kind: 'field' | 'unacknowledged'
  requestPath: string
  field: string
  location?: string
  type?: string
  label?: string
  options?: string[]
  at: Hop[]
  memberId?: string
  hint?: string
}

/** Two members; alice is fully specified for our purposes, bob is not. */
const ALICE = {
  id: 'alice',
  dateOfBirth: '1990-03-15',
  income: [{ id: 'pay-1', type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
  expenses: [],
  jobs: [],
  assets: [],
}

test('instanced is the default — entries carry kind and at without any flag', async () => {
  const res = await request(app)
    .post(SNAP_URL)
    .send({ members: [{ id: 'alice' }, { id: 'bob' }] })
  assert.equal(res.status, 200)
  const mi = res.body.determinations[0].missingInputs as Array<Record<string, unknown>>
  assert.ok(mi.length > 0, 'pending with missing inputs')
  for (const m of mi) {
    assert.ok('kind' in m, 'every entry has a kind')
    assert.ok(Array.isArray(m.at), 'every entry has an at address')
  }
  // Per-instance: dateOfBirth appears once per member that owes it.
  const dobs = mi.filter((m) => m.field === 'dateOfBirth') as Array<Entry>
  assert.equal(dobs.length, 2, 'one entry per owing member')
  assert.deepEqual(
    dobs.map((m) => m.at),
    [[{ in: 'members', id: 'alice' }], [{ in: 'members', id: 'bob' }]]
  )
})

test('missingInputsFormat is deprecated and ignored; "fields" earns a migration note', async () => {
  const withFlag = await request(app)
    .post(SNAP_URL)
    .send({ missingInputsFormat: 'fields', members: [{ id: 'alice' }] })
  assert.equal(withFlag.status, 200)
  const det = withFlag.body.determinations[0]
  const mi = det.missingInputs as Array<Record<string, unknown>>
  assert.ok(mi.every((m) => 'kind' in m && 'at' in m), 'response is instanced regardless of the flag')
  assert.ok(
    (det.notes as string[]).some((n) => n.includes('has been replaced')),
    'requesting the retired format earns a migration note'
  )
})

test('empty request: the first missing input is the members list itself', async () => {
  const res = await request(app)
    .post(SNAP_URL)
    .send({})
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]
  assert.equal(det.status, 'pending')
  const mi = det.missingInputs as Entry[]

  assert.deepEqual(
    { kind: mi[0].kind, requestPath: mi[0].requestPath, field: mi[0].field, at: mi[0].at },
    { kind: 'unacknowledged', requestPath: 'members', field: 'members', at: [] },
    'root recursion: an empty request is asked for the members list, in the same vocabulary'
  )
  assert.ok(mi[0].hint, 'unacknowledged entries carry a hint')

  // Household scalars are attributable (empty at); member fields are not —
  // the members entry stands in for all of them.
  const fieldEntries = mi.filter((m) => m.kind === 'field')
  assert.ok(fieldEntries.length > 0, 'household scalars still listed')
  for (const m of fieldEntries) {
    assert.deepEqual(m.at, [], 'only household-level field entries when there are no members')
    assert.ok(!m.location?.startsWith('members[]'), `unattributable member field leaked: ${m.requestPath}`)
  }
})

test('member fields address the member that owes them — not the one that answered', async () => {
  const res = await request(app)
    .post(SNAP_URL)
    .send({
      members: [ALICE, { id: 'bob', income: [], expenses: [], jobs: [], assets: [] }],
    })
  assert.equal(res.status, 200)
  const mi = res.body.determinations[0].missingInputs as Entry[]

  const dobs = mi.filter((m) => m.field === 'dateOfBirth')
  assert.equal(dobs.length, 1, 'exactly one member still owes dateOfBirth')
  assert.deepEqual(dobs[0].at, [{ in: 'members', id: 'bob' }])
  assert.equal(dobs[0].memberId, 'bob', 'memberId echoes at[0].id')
  assert.equal(dobs[0].kind, 'field')
})

test('unacknowledged sub-collection is asked per member, and withheld rows are not misattributed', async () => {
  // alice sends income rows; bob omits the income key entirely → the
  // collection is withheld (see v2-request acknowledgment rule) and the
  // response asks BOB the income question rather than listing per-field
  // income gaps.
  const res = await request(app)
    .post(SNAP_URL)
    .send({
      members: [ALICE, { id: 'bob', dateOfBirth: '1992-07-20', expenses: [], jobs: [], assets: [] }],
    })
  assert.equal(res.status, 200)
  const mi = res.body.determinations[0].missingInputs as Entry[]

  const unack = mi.filter((m) => m.kind === 'unacknowledged' && m.field === 'income')
  assert.deepEqual(
    unack.map((m) => m.at),
    [[{ in: 'members', id: 'bob' }]],
    'income question is asked of bob only — alice acknowledged'
  )
  const incomeFields = mi.filter((m) => m.kind === 'field' && m.location === 'members[].income[]')
  assert.equal(incomeFields.length, 0, 'no per-field income entries while the collection is withheld')
})

test('incomplete row: two-hop address down to the owing row', async () => {
  const res = await request(app)
    .post(SNAP_URL)
    .send({
      members: [
        {
          ...ALICE,
          income: [{ id: 'pay-1', type: 'wages_and_salaries', frequency: 'monthly' }], // amount omitted
        },
      ],
    })
  assert.equal(res.status, 200)
  const mi = res.body.determinations[0].missingInputs as Entry[]

  const amount = mi.find((m) => m.requestPath === 'members[].income[].amount')
  assert.ok(amount, 'the row-level amount gap is listed')
  assert.deepEqual(amount!.at, [
    { in: 'members', id: 'alice' },
    { in: 'income', id: 'pay-1' },
  ])
  assert.equal(amount!.memberId, 'alice')
  assert.equal(amount!.type, 'Dollar')
})

test('medicaid: entries slice per determination by address', async () => {
  const res = await request(app)
    .post(MEDICAID_URL)
    .send({
      members: [
        { id: 'alice', dateOfBirth: '1990-03-15', income: [], expenses: [], jobs: [], assets: [] },
        { id: 'bob', income: [], expenses: [], jobs: [], assets: [] },
      ],
    })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<{ memberId: string; missingInputs?: Entry[] }>
  const bob = dets.find((d) => d.memberId === 'bob')
  const alice = dets.find((d) => d.memberId === 'alice')
  assert.ok(bob && alice)

  for (const det of [alice!, bob!]) {
    for (const m of det.missingInputs ?? []) {
      const owner = m.at[0]?.in === 'members' ? m.at[0].id : undefined
      assert.ok(
        owner === undefined || owner === det.memberId,
        `${det.memberId}'s determination carries an entry addressed to ${owner}`
      )
    }
  }
  const bobDob = (bob!.missingInputs ?? []).find((m) => m.field === 'dateOfBirth')
  assert.ok(bobDob, "bob's determination lists his dateOfBirth gap")
  const aliceDob = (alice!.missingInputs ?? []).find((m) => m.field === 'dateOfBirth')
  assert.equal(aliceDob, undefined, "alice's determination does not carry bob's gap")
})

test('missingInputsByMember stays attached in instanced format (deprecation window)', async () => {
  const res = await request(app)
    .post(SNAP_URL)
    .send({
      members: [ALICE, { id: 'bob', income: [], expenses: [], jobs: [], assets: [] }],
    })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0]
  assert.ok(det.missingInputsByMember, 'byMember still present while the shape is evaluated')
  assert.ok(det.missingInputsByMember.bob, "bob's gaps still grouped in byMember")
})
