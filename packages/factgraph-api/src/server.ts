import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import type { Server } from 'node:http'

import { bearerAuth } from './middleware/auth.js'
import openapiRouter from './routes/openapi.js'
import consumerOpenapiRouter from './routes/consumer-openapi.js'
import { v2DocsRouter, v2StubsRouter } from './routes/v2-openapi.js'
import rulesetsRouter from './routes/rulesets.js'
import queryRouter from './routes/query.js'
import eligibilityRouter from './routes/eligibility.js'
import eligibilityV2SnapRouter from './routes/eligibility-v2-snap.js'
import eligibilityV2MedicaidRouter from './routes/eligibility-v2-medicaid.js'

/**
 * Build the Express app. Factored out of the listen call so it can be
 * imported by tests without binding to a port.
 */
export function buildApp() {
  const app = express()

  // Permissive CORS for the prototype — the API is intended to be
  // accessible to partner UIs running on arbitrary dev/test origins.
  // Tighten via CORS_ALLOWED_ORIGINS once we have a known consumer list.
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  app.use(
    cors({
      origin: allowedOrigins
        ? allowedOrigins.split(',').map((s) => s.trim())
        : true,
    })
  )

  app.use(express.json({ limit: '10mb' }))

  // Health probe — unauthenticated, used by deployment tooling and
  // anyone checking the API is reachable.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // OpenAPI spec + Swagger UI. Mounted before bearerAuth so docs are
  // public — partners shouldn't need credentials to read the contract.
  // The Swagger UI's own Authorize dialog handles the bearer token for
  // "Try it" calls.
  app.use('/v1/factgraph', openapiRouter)
  // Consumer-facing eligibility contract docs — also public, mounted before
  // the authed eligibility routes so /v1/eligibility/openapi.* and /docs are
  // reachable without a token.
  app.use('/v1/eligibility', consumerOpenapiRouter)
  // v2 contract — our own engine-shaped surface. Public spec/docs; per-program
  // determination + expedited-screening endpoints mounted before the stubs;
  // only /medicaid/ex-parte still 501.
  app.use('/v2/eligibility', v2DocsRouter)
  app.use('/v2/eligibility/snap', bearerAuth, eligibilityV2SnapRouter)
  app.use('/v2/eligibility/medicaid', bearerAuth, eligibilityV2MedicaidRouter)
  app.use('/v2/eligibility', bearerAuth, v2StubsRouter)

  // Versioned API surface. Auth applies to everything under /v1.
  app.use('/v1/factgraph', bearerAuth, rulesetsRouter)
  app.use('/v1/factgraph', bearerAuth, queryRouter)

  // Domain-oriented eligibility adapter (the partner contract's
  // /evaluate/... endpoints). Mounted at /v1/eligibility so a consumer can
  // point its adapter base URL here and the bare contract paths resolve.
  app.use('/v1/eligibility', bearerAuth, eligibilityRouter)

  // Error boundary — every failure mode responds with RFC 9457 Problem
  // Details, never Express's default HTML page (which includes a stack
  // trace outside production mode). Ordered after all routes so it
  // catches body-parser failures and anything a handler throws.
  app.use(errorHandler)

  return app
}

/** Map an error to RFC 9457 Problem Details. Body-parser failures keep
 *  their caller-error status codes (400 invalid JSON, 413 too large);
 *  everything else is a 500 whose detail deliberately omits internals —
 *  the full error is logged server-side (message and stack only; request
 *  bodies are never logged). */
function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) {
    next(err)
    return
  }
  const e = err as { type?: string; status?: number; message?: string; stack?: string }
  if (e.type === 'entity.parse.failed') {
    res.status(400).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Invalid JSON',
      status: 400,
      detail: `The request body is not valid JSON: ${e.message ?? 'parse error'}.`,
    })
    return
  }
  if (e.type === 'entity.too.large') {
    res.status(413).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Payload too large',
      status: 413,
      detail: 'The request body exceeds the 10 MB limit.',
    })
    return
  }
  console.error('Unhandled error:', e.stack ?? e.message ?? err)
  res.status(500).json({
    type: 'https://tools.ietf.org/html/rfc9457',
    title: 'Internal server error',
    status: 500,
    detail: 'An unexpected error occurred. If this persists, report the time and endpoint so the fault can be traced in server logs.',
  })
}

export function createServer(port: number): Server {
  const app = buildApp()
  return app.listen(port, () => {
    console.log(`Factgraph API listening on http://localhost:${port}`)
    if (process.env.API_BEARER_TOKEN === '') {
      console.log(
        'Auth: MISCONFIGURED (API_BEARER_TOKEN is set but empty — every protected request will 503). ' +
          'Set a real token or remove the variable entirely.'
      )
    } else if (process.env.API_BEARER_TOKEN === undefined) {
      console.log(
        'Auth: OPEN (API_BEARER_TOKEN unset — every request accepted). ' +
          "Set API_BEARER_TOKEN before any deployment that's reachable from outside this machine."
      )
    } else {
      console.log('Auth: bearer token required (API_BEARER_TOKEN is set).')
    }
  })
}
