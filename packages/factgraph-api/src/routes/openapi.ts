/**
 * OpenAPI surface — spec + interactive docs.
 *
 * Three endpoints, all unauthenticated (mounted before the bearer-auth
 * middleware in server.ts). Partners can read the contract without
 * needing a token; the Swagger UI has a built-in Authorize button for
 * "Try it" calls that exercise the real authenticated endpoints.
 */
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import yaml from 'yaml'

import { buildOpenApiDocument } from '../openapi.js'

const router = Router()

// Generate once at module load. The schemas don't change at runtime so
// there's no value re-running the registry walk per request.
const document = buildOpenApiDocument()
const yamlSerialized = yaml.stringify(document)

/**
 * GET /v1/factgraph/openapi.json
 *
 * Machine-readable OpenAPI 3.1 spec. Feed this to `openapi-typescript`,
 * `openapi-generator`, or any OpenAPI-aware client generator.
 */
router.get('/openapi.json', (_req, res) => {
  res.json(document)
})

/**
 * GET /v1/factgraph/openapi.yaml
 *
 * Same spec, YAML flavor. Some tooling (Spectral, certain renderers)
 * prefers YAML.
 */
router.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(yamlSerialized)
})

/**
 * GET /v1/factgraph/docs
 *
 * Swagger UI rendering of the spec. Includes an Authorize dialog where
 * partners paste their bearer token for live "Try it" calls.
 */
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(document, {
    customSiteTitle: 'Factgraph API — docs',
    swaggerOptions: {
      // Hide the "schema" boxes on collapsed responses; show the
      // example/payload first since most partners want to see the
      // shape, not click into a panel to find it.
      defaultModelsExpandDepth: -1,
      docExpansion: 'list',
    },
  })
)

export default router
