/**
 * Consumer-facing OpenAPI surface — the eligibility adapter contract.
 *
 * Served under `/v1/eligibility` (unauthenticated, like the advanced docs)
 * so the Worker Portal can read the contract without a token. Separate
 * document from the advanced Fact Graph API — see consumer-openapi.ts.
 */
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import yaml from 'yaml'

import { buildConsumerOpenApiDocument } from '../consumer-openapi.js'

const router = Router()

const document = buildConsumerOpenApiDocument()
const yamlSerialized = yaml.stringify(document)

/** GET /v1/eligibility/openapi.json — machine-readable consumer contract. */
router.get('/openapi.json', (_req, res) => {
  res.json(document)
})

/** GET /v1/eligibility/openapi.yaml — same, YAML. */
router.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(yamlSerialized)
})

/** GET /v1/eligibility/docs — Swagger UI for the consumer contract. */
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(document, {
    customSiteTitle: 'Eligibility Adapter API — docs',
    swaggerOptions: { defaultModelsExpandDepth: -1, docExpansion: 'list' },
  })
)

export default router
