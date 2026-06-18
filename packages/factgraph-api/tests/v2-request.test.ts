/**
 * Unit coverage for the friendly-request → engine-inputs translator. Asserts
 * the field-index-driven mapping against the real snap-complete model: friendly
 * fields land at the right engine paths, enums are cased, references resolve to
 * #N, nested rows get their memberId backlink, and nothing is defaulted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRuleset } from 'rules-visualizer-factgraph-core'

import './helpers.js'
import { translateRequest } from '../src/translate/v2-request.js'

const model = getRuleset('snap-complete')!

test('member fields map to engine paths; enums are cased; no-guess', () => {
  const { inputs, memberIds } = translateRequest(
    {
      members: [
        {
          id: 'head',
          age: 35,
          citizenshipImmigrationStatus: 'citizen',
          isHeadOfHousehold: true,
        },
      ],
    },
    model
  )
  assert.deepEqual(memberIds, ['head'])
  const rows = inputs['/members'] as Array<Record<string, unknown>>
  assert.equal(rows.length, 1)
  const head = rows[0]
  assert.equal(head.id, 'head')
  assert.equal(head['/members/*/age'], 35)
  // snake_case → engine PascalCase enum option.
  assert.equal(head['/members/*/citizenshipImmigrationStatus'], 'Citizen')
  assert.equal(head['/members/*/isHeadOfHousehold'], true)
  // No-guess: a field we didn't send is simply absent (not defaulted).
  assert.ok(!('/members/*/isStriker' in head), 'unprovided flag must not be defaulted')
})

test('references resolve to positional #N', () => {
  const { inputs } = translateRequest(
    {
      members: [
        { id: 'head', spouseId: 'spouse' },
        { id: 'spouse', spouseId: 'head' },
      ],
    },
    model
  )
  const rows = inputs['/members'] as Array<Record<string, unknown>>
  assert.equal(rows[0]['/members/*/spouseId'], '#1') // head → spouse (index 1)
  assert.equal(rows[1]['/members/*/spouseId'], '#0') // spouse → head (index 0)
})

test('nested income rows flatten to /incomes with a memberId backlink', () => {
  const { inputs } = translateRequest(
    {
      members: [
        {
          id: 'head',
          income: [{ type: 'wages_and_salaries', amount: 1200, frequency: 'monthly' }],
        },
      ],
    },
    model
  )
  const incomes = inputs['/incomes'] as Array<Record<string, unknown>>
  assert.equal(incomes.length, 1)
  assert.equal(incomes[0]['/incomes/*/memberId'], '#0')
  assert.equal(incomes[0]['/incomes/*/amount'], 1200)
  assert.equal(incomes[0]['/incomes/*/type'], 'WagesAndSalaries')
  assert.equal(incomes[0]['/incomes/*/frequency'], 'Monthly')
})

test('household scalars map to top-level inputs; unknown fields warn, not throw', () => {
  const { inputs, warnings } = translateRequest(
    { household: { livesInApplicationCounty: true, notARealField: 1 } },
    model
  )
  assert.equal(inputs['/livesInApplicationCounty'], true)
  assert.ok(warnings.some((w) => w.includes('notARealField')), 'unknown field is warned')
})

test('an empty request produces empty inputs (engine will report everything missing)', () => {
  const { inputs, memberIds } = translateRequest({}, model)
  assert.deepEqual(memberIds, [])
  assert.deepEqual(Object.keys(inputs), [])
})
