import express from 'express'
import cors from 'cors'
import type { Server } from 'node:http'

import { bearerAuth } from './middleware/auth.js'
import openapiRouter from './routes/openapi.js'
import consumerOpenapiRouter from './routes/consumer-openapi.js'
import { v2DocsRouter, v2StubsRouter } from './routes/v2-openapi.js'
import rulesetsRouter from './routes/rulesets.js'
import queryRouter from './routes/query.js'
import eligibilityRouter from './routes/eligibility.js'

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
  // v2 draft-proposal contract: public spec/docs; evaluate endpoints are
  // authed 501 stubs until the proposal is reviewed.
  app.use('/v2/eligibility', v2DocsRouter)
  app.use('/v2/eligibility', bearerAuth, v2StubsRouter)

  // Versioned API surface. Auth applies to everything under /v1.
  app.use('/v1/factgraph', bearerAuth, rulesetsRouter)
  app.use('/v1/factgraph', bearerAuth, queryRouter)

  // Domain-oriented eligibility adapter (the partner contract's
  // /evaluate/... endpoints). Mounted at /v1/eligibility so a consumer can
  // point its adapter base URL here and the bare contract paths resolve.
  app.use('/v1/eligibility', bearerAuth, eligibilityRouter)

  return app
}

export function createServer(port: number): Server {
  const app = buildApp()
  return app.listen(port, () => {
    console.log(`Factgraph API listening on http://localhost:${port}`)
    if (!process.env.API_BEARER_TOKEN) {
      console.log(
        'Auth: OPEN (API_BEARER_TOKEN unset — every request accepted). ' +
          "Set API_BEARER_TOKEN before any deployment that's reachable from outside this machine."
      )
    } else {
      console.log('Auth: bearer token required (API_BEARER_TOKEN is set).')
    }
  })
}
