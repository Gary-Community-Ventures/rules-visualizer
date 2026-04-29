/**
 * Single source of truth for whether the UI can mutate server state.
 *
 * When false, all reference editing (add/remove/link/comment/draw) is
 * hidden, and the Tasks panel/toolbar entry is not rendered. Pair with
 * the backend `ALLOW_WRITES` env var, which gates the corresponding
 * routes server-side as defense-in-depth.
 *
 * Vite inlines `import.meta.env.VITE_ALLOW_WRITES` at build time, so this
 * is a constant from the bundle's perspective — flipping it requires a
 * rebuild.
 */
export const ALLOW_WRITES = import.meta.env.VITE_ALLOW_WRITES === '1'
