import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'

/**
 * Bearer-token middleware.
 *
 * If `API_BEARER_TOKEN` is set, every request to a protected route must
 * carry `Authorization: Bearer <token>` with a matching value. If unset,
 * the middleware no-ops and the API is open — appropriate for local dev
 * and the earliest prototype phase. In any deployed environment, set
 * `API_BEARER_TOKEN` and share it with the partner team out of band.
 *
 * An *empty* `API_BEARER_TOKEN` (e.g. a bare `API_BEARER_TOKEN=` line in
 * a .env file) is treated as a misconfiguration and fails closed with a
 * 503 — the operator intended auth to be on, so silently running open
 * would be the worst possible reading of the mistake.
 *
 * Uses `timingSafeEqual` to compare so token-validation latency doesn't
 * leak information.
 */
export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_BEARER_TOKEN
  if (expected === undefined) {
    next()
    return
  }
  if (expected === '') {
    res.status(503).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Authentication misconfigured',
      status: 503,
      detail:
        'API_BEARER_TOKEN is set but empty on the server. Set a real token (auth on) or remove the variable entirely (auth off).',
    })
    return
  }

  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Authentication required',
      status: 401,
      detail:
        'Missing or malformed Authorization header. Expected "Bearer <token>".',
    })
    return
  }

  const provided = header.slice(7)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Different-length buffers can't be timingSafeEqual'd directly. Pad to
  // a fixed length so the comparison runs in constant time regardless of
  // input length.
  const max = Math.max(a.length, b.length)
  const aPadded = Buffer.alloc(max)
  const bPadded = Buffer.alloc(max)
  a.copy(aPadded)
  b.copy(bPadded)

  const sameLength = a.length === b.length
  const sameBytes = timingSafeEqual(aPadded, bPadded)
  if (!sameLength || !sameBytes) {
    res.status(401).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Invalid token',
      status: 401,
      detail: 'The provided bearer token does not match.',
    })
    return
  }

  next()
}
