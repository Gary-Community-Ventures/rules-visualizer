/**
 * Shared setup for API tests.
 *
 * Loads the fact-graph data directory once at import time, exposes the
 * built Express app for supertest, and exports a canonical SNAP-FY2026
 * household fixture so individual tests don't have to repeat 18 member
 * fields each.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFactGraphData } from 'rules-visualizer-factgraph-core'

import { buildApp } from '../src/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'factgraph')

// Side effect: register every ruleset under data/factgraph/ with the
// in-memory store. Re-entrant; calling it again would just re-read.
loadFactGraphData(DATA_DIR)

export const app = buildApp()

export const RULESET_ID = 'snap-fy2026'

/** Caller-IDed single member with every per-member field filled. */
export const APPLICANT_ROW = {
  id: 'applicant',
  '/members/*/isElderly': false,
  '/members/*/isDisabled': false,
  '/members/*/medicalExpenses': 0,
  '/members/*/age': 30,
  '/members/*/isHigherEdStudent': false,
  '/members/*/weeklyWorkHours': 40,
  '/members/*/isWorkStudy': false,
  '/members/*/isParent': false,
  '/members/*/isFullTimeCollegeStudent': false,
  '/members/*/receivesTanf': false,
  '/members/*/isImmigrationEligible': true,
  '/members/*/isPregnant': false,
  '/members/*/isIncapableOfSelfCare': false,
  '/members/*/abawdCountableMonthsUsed': 0,
  '/members/*/cashOnHand': 0,
  '/members/*/bankAccountAssets': 0,
  '/members/*/stockAssets': 0,
  '/members/*/bondAssets': 0,
} as const

/** A second member, age 5, no income/assets — a child. */
export const CHILD_ROW = {
  ...APPLICANT_ROW,
  id: 'child',
  '/members/*/age': 5,
  '/members/*/weeklyWorkHours': 0,
} as const

/** Scalar inputs zeroed for a no-income single-person household. */
export const ZEROED_SCALARS = {
  '/grossEarnedIncome': 0,
  '/unearnedIncome': 0,
  '/dependentCareExpenses': 0,
  '/rent': 0,
  '/realEstateTaxes': 0,
  '/homeownersAssociationFees': 0,
  '/mortgagePayments': 0,
  '/homeownersInsurance': 0,
  '/meetsCategoricalEligibility': false,
  '/childSupportPaid': 0,
  '/isHomeless': false,
} as const

/** Run a snippet with an env var temporarily set, restoring the original
 *  value (or absence) when the body returns. Used by auth tests. */
export async function withEnv(
  name: string,
  value: string | undefined,
  body: () => Promise<void>
): Promise<void> {
  const had = Object.prototype.hasOwnProperty.call(process.env, name)
  const original = process.env[name]
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
  try {
    await body()
  } finally {
    if (had) {
      process.env[name] = original
    } else {
      delete process.env[name]
    }
  }
}
