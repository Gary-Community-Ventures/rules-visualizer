/**
 * Shared helpers for the v2 eligibility routes.
 */
import type { Response } from 'express'
import { getRuleset, getRawFacts } from 'rules-visualizer-factgraph-core'

import { runQuery, type QueryResponse } from '../evaluate.js'

export function problem(
  res: Response,
  status: number,
  title: string,
  detail: string
): void {
  res
    .status(status)
    .json({ type: 'https://tools.ietf.org/html/rfc9457', title, status, detail })
}

/** Run targets against a ruleset; returns the response, or null after writing
 *  a 5xx Problem Details (all server-side faults — a missing ruleset or a bad
 *  target our own translation produced, never the caller's input). */
export function run(
  res: Response,
  rulesetId: string,
  inputs: Record<string, unknown>,
  targets: readonly string[],
  include: string[] | undefined
): QueryResponse | null {
  const model = getRuleset(rulesetId)
  const facts = getRawFacts(rulesetId)
  if (!model || !facts) {
    problem(res, 503, 'Ruleset unavailable', `"${rulesetId}" is not loaded.`)
    return null
  }
  let result
  try {
    result = runQuery(rulesetId, model, facts, {
      targets: [...targets],
      inputs,
      include,
    })
  } catch (e) {
    problem(res, 500, 'Execution failed', (e as Error).message)
    return null
  }
  if (!result.ok) {
    problem(
      res,
      500,
      'Internal evaluation error',
      `Targets not found in "${rulesetId}": ${result.unknownTargets.join(', ')}. This is an adapter bug.`
    )
    return null
  }
  return result.response
}

/** ISO yyyy-mm-dd (UTC) for the echoed evaluation date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Parse a strict `yyyy-mm-dd` evaluation date. Returns null when the
 *  string is malformed OR when JS date rollover would silently shift it
 *  (`2026-02-30` parses as March 2) — a typo'd date must not silently
 *  skew age derivation. */
export function parseAsOf(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime()) || isoDay(d) !== raw) return null
  return d
}

/** Note returned when a caller asks for the retired pre-instanced format. */
export const FIELDS_FORMAT_GONE =
  'missingInputsFormat "fields" has been replaced: missingInputs now always ' +
  'uses the instanced shape (one entry per concrete instance, addressed by ' +
  '`at` hops, plus "unacknowledged" collection questions). The flag is ' +
  'ignored. See docs/changelog.md for the migration.'
