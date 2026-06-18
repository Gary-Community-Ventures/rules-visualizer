/**
 * v2 engine-shaped surface.
 *
 * Serves the v2 contract (see v2-openapi.ts) at /v2/eligibility/openapi.{json,yaml}
 * + /docs — public, like the other contract docs. /evaluate/determination is
 * implemented (mounted ahead of these stubs in server.ts); the other evaluate
 * tails (expedited-screening, medicaid-ex-parte) are not built yet and stub to
 * 501 with a pointer to the implemented v1 surface.
 */
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import yaml from 'yaml'

import { buildV2OpenApiDocument } from '../v2-openapi.js'

const document = buildV2OpenApiDocument()
const yamlSerialized = yaml.stringify(document)

/** Public: spec + Swagger UI. */
export const v2DocsRouter = Router()

v2DocsRouter.get('/openapi.json', (_req, res) => {
  res.json(document)
})

v2DocsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(yamlSerialized)
})

// serveFiles, not the shared `serve` — three Swagger UIs live in this app;
// see routes/openapi.ts for the collision this avoids.
v2DocsRouter.use(
  '/docs',
  swaggerUi.serveFiles(document),
  swaggerUi.setup(document, {
    customSiteTitle: 'Eligibility API v2 (engine-shaped) — docs',
    swaggerOptions: { defaultModelsExpandDepth: -1, docExpansion: 'list' },
  })
)

/** Authed: the not-yet-built evaluate tails, stubbed 501. (/evaluate/determination
 *  is the real endpoint, mounted ahead of this router in server.ts, so its
 *  stub here is shadowed.) */
export const v2StubsRouter = Router()

for (const tail of ['/evaluate/expedited-screening', '/evaluate/medicaid-ex-parte']) {
  v2StubsRouter.post(tail, (_req, res) => {
    res.status(501).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Not yet implemented',
      status: 501,
      detail:
        'This v2 endpoint is not built yet. The implemented surface is /v1/eligibility' +
        tail +
        '.',
    })
  })
}
