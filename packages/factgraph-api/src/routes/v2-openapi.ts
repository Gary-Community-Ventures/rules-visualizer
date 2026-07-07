/**
 * v2 engine-shaped surface.
 *
 * Serves the v2 contract (see v2-openapi.ts) at /v2/eligibility/openapi.{json,yaml}
 * + /docs — public, like the other contract docs. The per-program determination
 * endpoints (/snap/determination, /medicaid/determination,
 * /snap/expedited-screening) are implemented and mounted in server.ts;
 * only /medicaid/ex-parte stubs to 501.
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

/** Authed: not-yet-built v2 operation tails, stubbed 501 with a pointer to the
 *  corresponding v1 implementation. */
export const v2StubsRouter = Router()

const STUBS: Record<string, string> = {
  '/medicaid/ex-parte': '/evaluate/medicaid-ex-parte',
}

for (const [v2Tail, v1Tail] of Object.entries(STUBS)) {
  v2StubsRouter.post(v2Tail, (_req, res) => {
    res.status(501).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Not yet implemented',
      status: 501,
      detail:
        'This v2 endpoint is not built yet. The implemented surface is /v1/eligibility' +
        v1Tail +
        '.',
    })
  })
}

// Unknown program: a Problem Details 404 naming the supported programs,
// instead of Express's default HTML "Cannot POST" page. Mounted after the
// real per-program routers, so this only sees programs we don't serve.
v2StubsRouter.post(
  ['/:program/determination', '/:program/expedited-screening'],
  (req, res) => {
    res.status(404).json({
      type: 'https://tools.ietf.org/html/rfc9457',
      title: 'Unknown operation',
      status: 404,
      detail:
        `POST /v2/eligibility/${req.params.program}${req.path.replace(`/${req.params.program}`, '')} does not exist. ` +
        'Available operations: POST /v2/eligibility/snap/determination, POST /v2/eligibility/snap/expedited-screening, POST /v2/eligibility/medicaid/determination.',
    })
  }
)
