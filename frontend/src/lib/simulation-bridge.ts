/**
 * Bridge between the simulation page and the visualizer tabs.
 *
 * When the user clicks "Open in Visualizer" on a simulation case, we store
 * the scenario in localStorage. When a ModelProvider mounts for the matching
 * rulesetId, it picks up the pending scenario, loads the inputs, opens the
 * execution panel, and auto-runs.
 *
 * localStorage is used (not module-level state) because window.open creates
 * a new JS context that can't access the opener's in-memory data.
 */

export type PendingScenario = {
  rulesetId: string
  inputs: Record<string, unknown>
  entities?: Record<string, Record<string, unknown>[]>
  label?: string // e.g. "Simulation case #47"
  /** Node path to select in the filter and open in the detail panel */
  focusNode?: string
}

const STORAGE_PREFIX = 'sim-pending:'

/** Queue a scenario to be loaded when the given rulesetId tab mounts. */
export function setPendingScenario(scenario: PendingScenario): void {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + scenario.rulesetId,
      JSON.stringify(scenario)
    )
  } catch {
    // ignore quota errors
  }
}

/** Check if there's a pending scenario without consuming it. */
export function hasPendingScenario(rulesetId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + rulesetId) !== null
  } catch {
    return false
  }
}

/** Consume the pending scenario for a rulesetId (returns and clears it). */
export function consumePendingScenario(
  rulesetId: string
): PendingScenario | undefined {
  try {
    const key = STORAGE_PREFIX + rulesetId
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    localStorage.removeItem(key)
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
