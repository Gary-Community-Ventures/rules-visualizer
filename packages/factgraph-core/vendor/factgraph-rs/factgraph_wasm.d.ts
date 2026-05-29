/* tslint:disable */
/* eslint-disable */

/**
 * Long-lived handle to a parsed fact-graph dictionary.
 *
 * Construct once per ruleset, then call `execute(request)` many times.
 * The handle owns the parsed AST and any per-graph memoization cache
 * (which lives only inside a single `execute` call).
 */
export class FactGraph {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Run the ruleset against a `{inputs, entities, read_paths}` request.
     * Returns a plain object keyed by fact path.
     */
    execute(request: any): any;
    /**
     * Phase breakdown for the most recent `execute` call. Returns
     * `{deserializeMs, engineMs, serializeMs}` — sum is the full WASM
     * call time as the caller sees it. Lets a bench harness decompose
     * WASM-call wall time into JS↔WASM serde cost vs. engine work.
     */
    lastExecuteTimings(): any;
    /**
     * Parse a fact-graph XML module into a reusable handle.
     */
    constructor(xml: string);
    /**
     * Number of facts in the parsed dictionary. Useful for diagnostics.
     */
    readonly factCount: number;
}

export function _start(): void;

/**
 * Parse a fact-graph XML module and execute it with the given
 * `{inputs, entities, read_paths}` request in a single call.
 *
 * For repeated executions against the same ruleset, use `FactGraph`
 * to avoid re-parsing.
 */
export function executeFactGraph(xml: string, request: any): any;
