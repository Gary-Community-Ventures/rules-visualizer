/**
 * Instanced missing-inputs attribution matrix.
 *
 * Promotes behaviors that past audit probes verified by hand but never
 * pinned: row-level attribution across THREE members with interleaved
 * income rows, the union⊇byMember consistency contract, jobs[]/assets[]
 * two-hop addressing (previously untested collections), mixed
 * approved/pending medicaid statuses, the household-level
 * caregiverRelationships acknowledgment question, and the raw /query
 * engine surface for sub-collection instances.
 *
 * Everything here drives the public wire contract only — no internals.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'
import { buildFriendlyRequest } from './snap-golden-fixture.js'

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
  at: Hop[]
  memberId?: string
  hint?: string
}

/** Stable string form of an instance address, for counting/dedupe checks. */
const addr = (e: Entry) => e.at.map((h) => `${h.in}:${h.id}`).join('/')

// ---------------------------------------------------------------------------
// 1. Three members, interleaved income rows — per-row attribution
// ---------------------------------------------------------------------------

test('three-member household: each income-row gap is addressed to the right member AND row, exactly once', async () => {
  const res = await request(app).post(SNAP_URL).send({
    members: [
      {
        id: 'alice',
        dateOfBirth: '1990-01-01',
        income: [
          // a-inc-1 answers frequency but not amount; a-inc-2 the reverse.
          { id: 'a-inc-1', type: 'wages_and_salaries', frequency: 'monthly' },
          { id: 'a-inc-2', type: 'wages_and_salaries', amount: 300 },
        ],
        expenses: [], jobs: [], assets: [],
      },
      { id: 'bob', dateOfBirth: '1985-06-15', income: [], expenses: [], jobs: [], assets: [] },
      {
        id: 'carol',
        dateOfBirth: '1970-02-02',
        income: [{ id: 'c-inc-1', type: 'wages_and_salaries', amount: 900, frequency: 'monthly' }],
        expenses: [], jobs: [], assets: [],
      },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  assert.equal(det.status, 'pending')
  const mi = det.missingInputs as Entry[]

  // The amount gap belongs to alice's FIRST row only. Exactly one entry:
  // the instanced shape is per (field, row), not per field, and carol's
  // row provided its amount so no second instance may exist.
  const amounts = mi.filter((m) => m.kind === 'field' && m.requestPath === 'members[].income[].amount')
  assert.equal(amounts.length, 1, `expected exactly one amount gap, got ${amounts.length}`)
  assert.deepEqual(amounts[0].at, [
    { in: 'members', id: 'alice' },
    { in: 'income', id: 'a-inc-1' },
  ])
  assert.equal(amounts[0].memberId, 'alice', 'memberId crutch echoes at[0].id')

  // The frequency gap belongs to alice's SECOND row only.
  const freqs = mi.filter((m) => m.kind === 'field' && m.requestPath === 'members[].income[].frequency')
  assert.equal(freqs.length, 1, `expected exactly one frequency gap, got ${freqs.length}`)
  assert.deepEqual(freqs[0].at, [
    { in: 'members', id: 'alice' },
    { in: 'income', id: 'a-inc-2' },
  ])

  // Every row provided `type`, so no row owes it.
  const types = mi.filter((m) => m.requestPath === 'members[].income[].type')
  assert.equal(types.length, 0, 'type was provided on every row — no instance may ask for it')

  // bob asserted "no income" with []. He owns no rows, so NO income-row
  // entry may be addressed through him — a row gap misattributed to the
  // member who answered the question would be the exact bug the instanced
  // shape exists to prevent.
  const rowEntries = mi.filter((m) => m.at.length === 2 && m.at[1].in === 'income')
  assert.ok(rowEntries.length > 0, 'row-level entries present')
  assert.ok(
    rowEntries.every((m) => m.at[0].id !== 'bob'),
    'no income-row gap is attributed to bob (income: [])'
  )
  // carol's row is complete in the fields this test controls; other
  // engine row questions (targetPayDate, exclusion fields, …) MAY appear
  // for her row — that is correct: her row exists, so unanswered row-level
  // questions are hers. But never the ones she answered.
  for (const f of ['amount', 'frequency', 'type']) {
    assert.ok(
      !rowEntries.some((m) => m.field === f && m.at[0].id === 'carol'),
      `carol answered ${f} — it must not be re-asked of her row`
    )
  }
  // Row addresses only reference rows that actually exist in the request.
  const rowIds = new Set(rowEntries.map((m) => m.at[1].id))
  for (const id of rowIds) {
    assert.ok(['a-inc-1', 'a-inc-2', 'c-inc-1'].includes(id), `unknown row id ${id} in an address`)
  }

  // Each (question, instance) pair appears at most once — the dedupe by
  // (path, address) is part of the contract, otherwise a UI would render
  // duplicate prompts.
  const seen = new Set<string>()
  for (const m of mi) {
    const key = `${m.kind}|${m.requestPath}|${addr(m)}`
    assert.ok(!seen.has(key), `duplicate entry: ${key}`)
    seen.add(key)
  }

  // union ⊇ byMember consistency: the deprecated missingInputsByMember is
  // documented as derivable from missingInputs by grouping on at[0].id.
  // Pin that derivability exactly (audits flagged this as asserted nowhere):
  // for each member, the SET of requestPaths in byMember equals the set of
  // requestPaths of kind-field entries whose first hop is that member.
  const byMember = det.missingInputsByMember as Record<string, Array<{ requestPath: string }>>
  assert.ok(byMember, 'missingInputsByMember still served during the deprecation window')
  const grouped: Record<string, Set<string>> = {}
  for (const m of mi) {
    if (m.kind === 'field' && m.at[0]?.in === 'members') {
      ;(grouped[m.at[0].id] ??= new Set()).add(m.requestPath)
    }
  }
  assert.deepEqual(
    Object.keys(byMember).sort(),
    Object.keys(grouped).sort(),
    'byMember covers exactly the members that own field entries'
  )
  for (const [memberId, entries] of Object.entries(byMember)) {
    assert.deepEqual(
      new Set(entries.map((e) => e.requestPath)),
      grouped[memberId],
      `byMember[${memberId}] must equal groupBy(at[0].id) of the instanced entries`
    )
  }
})

// ---------------------------------------------------------------------------
// 2. jobs[] and assets[] — the sub-collections no test ever pinned
// ---------------------------------------------------------------------------

test('jobs/assets row gaps get two-hop addresses when every member acknowledged the collections', async () => {
  const res = await request(app).post(SNAP_URL).send({
    members: [
      {
        id: 'dana',
        dateOfBirth: '1990-01-01',
        income: [], expenses: [],
        jobs: [{ id: 'job-1', isSelfEmployed: false }],          // hoursPerWeek omitted
        assets: [{ id: 'asset-1', type: 'checking_account' }],   // value omitted
      },
      { id: 'eve', dateOfBirth: '1992-01-01', income: [], expenses: [], jobs: [], assets: [] },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const mi = det.missingInputs as Entry[]

  const hours = mi.filter((m) => m.field === 'hoursPerWeek')
  assert.equal(hours.length, 1, 'exactly one hoursPerWeek gap')
  assert.deepEqual(hours[0].at, [
    { in: 'members', id: 'dana' },
    { in: 'jobs', id: 'job-1' },
  ])
  assert.equal(hours[0].requestPath, 'members[].jobs[].hoursPerWeek')
  assert.equal(hours[0].kind, 'field')
  assert.equal(hours[0].type, 'Int')

  const values = mi.filter((m) => m.field === 'value' && m.location === 'members[].assets[]')
  assert.equal(values.length, 1, 'exactly one asset value gap')
  assert.deepEqual(values[0].at, [
    { in: 'members', id: 'dana' },
    { in: 'assets', id: 'asset-1' },
  ])
  assert.equal(values[0].type, 'Dollar')

  // Both members acknowledged jobs and assets, so the collection QUESTION
  // is settled — no unacknowledged jobs/assets entries, and no jobs/assets
  // row gap may be addressed through eve (her [] means she owns no rows).
  assert.ok(
    !mi.some((m) => m.kind === 'unacknowledged' && (m.field === 'jobs' || m.field === 'assets')),
    'no unacknowledged jobs/assets question when everyone answered with rows or []'
  )
  assert.ok(
    !mi.some((m) => m.at[0]?.id === 'eve' && m.at.length === 2),
    'no row-level gap attributed to eve, who owns no rows'
  )
  // Nothing was withheld, so no withheld-rows disclosure note.
  assert.ok(
    !((det.notes ?? []) as string[]).some((n) => n.includes('jobs')),
    'no jobs disclosure note when the collection was fully acknowledged'
  )
})

test('a member omitting the jobs key withholds the collection: unacknowledged ask, no per-field jobs entries, disclosure note', async () => {
  const res = await request(app).post(SNAP_URL).send({
    members: [
      {
        id: 'dana',
        dateOfBirth: '1990-01-01',
        income: [], expenses: [],
        jobs: [{ id: 'job-1', isSelfEmployed: false }],          // rows provided…
        assets: [{ id: 'asset-1', type: 'checking_account' }],
      },
      // …but eve never answers the jobs question (key absent entirely), so
      // treating her as "zero jobs" would hand the engine a wrong count.
      { id: 'eve', dateOfBirth: '1992-01-01', income: [], expenses: [], assets: [] },
    ],
  })
  assert.equal(res.status, 200)
  const det = res.body.determinations[0] as Record<string, unknown>
  const mi = det.missingInputs as Entry[]

  // The jobs question is asked of eve alone — dana acknowledged with rows.
  const asks = mi.filter((m) => m.kind === 'unacknowledged' && m.field === 'jobs')
  assert.deepEqual(
    asks.map((m) => m.at),
    [[{ in: 'members', id: 'eve' }]],
    'the jobs question is addressed to the member who never answered it'
  )
  assert.ok(asks[0].hint, 'unacknowledged entries carry a how-to-answer hint')

  // While the collection is withheld there are no rows to attribute to, so
  // the per-field jobs entries must vanish — the unacknowledged entry
  // stands in for all of them (suppression by construction).
  assert.equal(
    mi.filter((m) => m.location === 'members[].jobs[]').length,
    0,
    'no per-field jobs entries while the collection is withheld'
  )

  // Withheld rows are disclosed, never silently discarded: dana DID send a
  // jobs row and it was not evaluated.
  const notes = (det.notes ?? []) as string[]
  assert.ok(
    notes.some((n) => n.startsWith('jobs:') && n.includes('not evaluated')),
    `expected the withheld-jobs disclosure note, got: ${JSON.stringify(notes)}`
  )

  // assets was acknowledged by everyone, so its row gap still addresses
  // normally — withholding one collection must not suppress another.
  const values = mi.filter((m) => m.field === 'value' && m.location === 'members[].assets[]')
  assert.deepEqual(values.map((m) => m.at), [
    [{ in: 'members', id: 'dana' }, { in: 'assets', id: 'asset-1' }],
  ])
})

// ---------------------------------------------------------------------------
// 3. Medicaid mixed statuses — no cross-attribution between determinations
// ---------------------------------------------------------------------------

/** A fully-answered adult (medicaid has NO placeholder defaults, so every
 *  category/work/legal-status question needs an answer for finality). */
const answeredAdult = (id: string) => ({
  id,
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
  income: [{ type: 'wages_and_salaries', amount: 500, frequency: 'monthly' }],
})

test('medicaid mixed statuses: the approved member carries no missingInputs; the pending member carries only their own', async () => {
  const pendingMember: Record<string, unknown> = answeredAdult('pat')
  delete pendingMember.dateOfBirth // the single unanswered question

  const res = await request(app).post(MEDICAID_URL).send({
    members: [answeredAdult('amy'), pendingMember],
  })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>
  const amy = dets.find((d) => d.memberId === 'amy')!
  const pat = dets.find((d) => d.memberId === 'pat')!
  assert.ok(amy && pat, 'both determinations present')

  // amy answered everything — her decision is FINAL despite pat's gap
  // (age gates one member's category, not the other's), so her
  // determination must not ask for anything.
  assert.equal(amy.status, 'approved')
  assert.ok(!('missingInputs' in amy), 'approved determination carries no missingInputs')

  // pat is pending on exactly the question they skipped.
  assert.equal(pat.status, 'pending')
  const patMissing = pat.missingInputs as Entry[]
  assert.ok(
    patMissing.some((m) => m.field === 'dateOfBirth'),
    `pat's own dateOfBirth gap is listed; got: ${patMissing.map((m) => m.field).join(', ')}`
  )

  // No cross-attribution: every member-addressed entry on a determination
  // names that determination's member. (Household-level entries — empty
  // `at` — are legitimately shared and allowed on both.)
  for (const det of [amy, pat]) {
    for (const m of (det.missingInputs ?? []) as Entry[]) {
      if (m.at[0]?.in === 'members') {
        assert.equal(
          m.at[0].id,
          det.memberId,
          `${det.memberId}'s determination carries an entry addressed to ${m.at[0].id}`
        )
      }
    }
  }
})

// ---------------------------------------------------------------------------
// 4. caregiverRelationships — the household-level collection question
// ---------------------------------------------------------------------------

test('omitting caregiverRelationships surfaces the unacknowledged household question at the root; [] answers it', async () => {
  // The golden fixture is a complete, approvable request. Removing only
  // caregiverRelationships withholds the one household-level collection,
  // so the determination pends and the union needs caregiver fields.
  const full = buildFriendlyRequest()
  const { caregiverRelationships: _cr, ...withoutCr } = full as Record<string, unknown>
  void _cr

  const omitted = await request(app).post(SNAP_URL).send(withoutCr)
  assert.equal(omitted.status, 200)
  const omittedDet = omitted.body.determinations[0] as Record<string, unknown>
  assert.equal(omittedDet.status, 'pending', 'withholding the collection must block finality')
  const omittedMi = omittedDet.missingInputs as Entry[]

  // The ask addresses the request ROOT (at: []) — caregiverRelationships
  // belongs to no member, which is exactly the case the hop-chain design
  // handles that a memberId-centric shape cannot.
  const asks = omittedMi.filter(
    (m) => m.kind === 'unacknowledged' && m.field === 'caregiverRelationships'
  )
  assert.equal(asks.length, 1, 'exactly one caregiverRelationships question')
  assert.deepEqual(
    { requestPath: asks[0].requestPath, at: asks[0].at },
    { requestPath: 'caregiverRelationships', at: [] }
  )
  assert.ok(asks[0].hint, 'the ask explains how to answer (rows or [])')

  // Same request WITH the explicit empty answer: the question is settled,
  // the entry is gone, and the full fixture resolves to a decision.
  const answered = await request(app).post(SNAP_URL).send(full)
  assert.equal(answered.status, 200)
  const answeredDet = answered.body.determinations[0] as Record<string, unknown>
  assert.equal(answeredDet.status, 'approved', 'the golden fixture is decidable once acknowledged')
  const answeredMi = (answeredDet.missingInputs ?? []) as Entry[]
  assert.equal(
    answeredMi.filter((m) => m.field === 'caregiverRelationships').length,
    0,
    'caregiverRelationships: [] answers the question — the entry disappears'
  )
})

// ---------------------------------------------------------------------------
// 5. /query engine surface — sub-collection instances without /members
// ---------------------------------------------------------------------------

test('/query missingInputInstances for a sub-collection without /members: engine roots and member-N row-id fallback', async () => {
  // The advanced surface speaks ENGINE vocabulary: hop roots are engine
  // collection roots (`/incomes`), not the friendly request keys, and a
  // row without an id falls back to the positional `member-N` naming
  // (evaluate.ts uses one fallback scheme for every collection, so an
  // income row is addressed as "member-1" — a known quirk of the raw
  // surface, translated away by the v2 adapter). Pinned as-is because
  // this is the engine-path surface contract today.
  const res = await request(app).post('/v1/factgraph/snap-complete/query').send({
    targets: ['/allotment'],
    inputs: {
      '/incomes': [
        { id: 'row-1', '/incomes/*/type': 'WagesAndSalaries' },
        { '/incomes/*/type': 'WagesAndSalaries' }, // no id → positional fallback
      ],
    },
    include: ['missingInputInstances'],
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'incomplete')
  const inst = res.body.missingInputInstances as Array<{
    path: string
    dataType: string
    hops: Array<{ root: string; id: string }>
  }>
  assert.ok(Array.isArray(inst) && inst.length > 0, 'instances present')

  // Rows carry no memberId back-link (no /members provided), so every
  // address is a single hop into /incomes.
  const hopped = inst.filter((i) => i.hops.length > 0)
  assert.ok(hopped.length > 0, 'row-addressed instances present')
  for (const i of hopped) {
    assert.equal(i.hops.length, 1, 'single-hop addresses without a member back-link')
    assert.equal(i.hops[0].root, '/incomes', 'hop roots are engine collection roots')
  }

  // Caller id preserved for row 0; positional member-1 fallback for row 1.
  const amounts = inst.filter((i) => i.path === '/incomes/*/amount')
  assert.deepEqual(
    amounts.map((i) => i.hops[0].id).sort(),
    ['member-1', 'row-1'],
    'amount owed once per row: caller id kept, id-less row named member-1'
  )

  // The raw surface exposes the memberId back-link itself as a missing
  // instance (dataType CollectionItem) — the engine genuinely needs it to
  // link rows to members. The v2 adapter hides it (kind `implied`, set by
  // nesting); here it must remain visible so /query callers know the rows
  // are unlinked.
  const backLinks = inst.filter((i) => i.path === '/incomes/*/memberId')
  assert.equal(backLinks.length, 2, 'the memberId back-link is owed by each row')
  for (const b of backLinks) assert.equal(b.dataType, 'CollectionItem')
})
