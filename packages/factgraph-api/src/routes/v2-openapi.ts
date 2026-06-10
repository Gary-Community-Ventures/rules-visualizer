/**
 * v2 draft-proposal surface.
 *
 * Serves the proposed contract revision (see v2-openapi.ts) at
 * /v2/eligibility/openapi.{json,yaml} + /docs — public, like the other
 * contract docs. The evaluate endpoints exist as 501 stubs (mounted behind
 * auth in server.ts) so a caller who tries the draft gets a clear pointer
 * to the implemented v1 surface rather than a 404.
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
    customSiteTitle: 'Eligibility Adapter API v2 (draft) — docs',
    swaggerOptions: { defaultModelsExpandDepth: -1, docExpansion: 'list' },
  })
)

/** Authed: the three evaluate endpoints, stubbed 501 until the proposal is
 *  reviewed and implemented. */
export const v2StubsRouter = Router()

for (const tail of [
  '/evaluate/determination',
  '/evaluate/expedited-screening',
  '/evaluate/medicaid-ex-parte',
]) {
  v2StubsRouter.post(tail, (_req, res) => {
    res.status(501).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Draft proposal — not implemented',
      status: 501,
      detail:
        'The v2 contract is a draft proposal under review (see /v2/eligibility/docs). ' +
        'The implemented surface is /v1/eligibility' + tail + '.',
    })
  })
}
