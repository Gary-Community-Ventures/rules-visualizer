/**
 * v2 Medicaid eligibility — POST /v2/eligibility/medicaid/determination.
 * Per-member scope: one request, one determination per household member.
 * Covers basic shape, per-member missingInputs attribution, empty body, and
 * the no-x-/no-path discipline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import { app } from './helpers.js'

const URL = '/v2/eligibility/medicaid/determination'

test('returns one member-scoped determination per member', async () => {
  const res = await request(app).post(URL).send({
    metadata: { caseId: 'v2-medicaid-test' },
    members: [
      {
        id: 'head',
        dateOfBirth: '1990-03-15',
        citizenshipImmigrationStatus: 'citizen',
        isHeadOfHousehold: true,
      },
    ],
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.metadata.caseId, 'v2-medicaid-test')
  const dets = res.body.determinations as Array<Record<string, unknown>>
  assert.ok(dets.length >= 1, 'at least one determination')
  assert.equal(dets[0].scope, 'member')
  assert.equal(dets[0].memberId, 'head')
})

test('per-member missingInputs — each member gets only their own unresolved fields', async () => {
  // head has dateOfBirth; spouse does not. Attribution should surface
  // dateOfBirth in spouse's missingInputs but not in head's.
  const res = await request(app).post(URL).send({
    programs: ['medicaid'],
    members: [
      { id: 'head', dateOfBirth: '1990-01-01', citizenshipImmigrationStatus: 'citizen' },
      { id: 'spouse' },
    ],
  })
  assert.equal(res.status, 200)
  const dets = res.body.determinations as Array<Record<string, unknown>>

  const headDet = dets.find((d) => d.memberId === 'head')
  const spouseDet = dets.find((d) => d.memberId === 'spouse')
  assert.ok(headDet, 'expected head determination')
  assert.ok(spouseDet, 'expected spouse determination')

  const headFields = ((headDet!.missingInputs ?? []) as Array<{ field: string }>).map(
    (m) => m.field
  )
  const spouseFields = ((spouseDet!.missingInputs ?? []) as Array<{ field: string }>).map(
    (m) => m.field
  )

  assert.ok(
    !headFields.includes('dateOfBirth'),
    `head should not need dateOfBirth; got: ${headFields.join(', ')}`
  )
  assert.ok(
    spouseFields.includes('dateOfBirth'),
    `spouse should need dateOfBirth; got: ${spouseFields.join(', ')}`
  )
})

test('an empty body is valid — returns pending with inputs needed', async () => {
  const res = await request(app).post(URL).send({})
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.determinations))
  assert.equal(res.body.metadata, undefined)
})

test('invalid asOf is a 400 Problem Details', async () => {
  const res = await request(app).post(URL).send({
    asOf: 'not-a-date',
    members: [{ id: 'head' }],
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.status, 400)
})

test('response leaks no x- fields or Fact Graph paths', async () => {
  const res = await request(app).post(URL).send({
    members: [
      {
        id: 'head',
        dateOfBirth: '1990-03-15',
        citizenshipImmigrationStatus: 'citizen',
      },
    ],
  })
  const text = JSON.stringify(res.body)
  assert.ok(!/"x-/.test(text), 'no x- overlay fields on the v2 surface')
  assert.ok(!text.includes('/members/*/') && !text.includes('/meets'), 'no Fact Graph paths')
})
