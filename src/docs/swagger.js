import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openApiSpecPath = path.resolve(__dirname, 'openApiSpec.json');
const swaggerDocument = JSON.parse(fs.readFileSync(openApiSpecPath, 'utf8'));

// The spec maps every admin/internal endpoint, so it's off in production
// unless explicitly opted in with SWAGGER_ENABLED=true.
const swaggerEnabled =
  process.env.SWAGGER_ENABLED !== undefined
    ? process.env.SWAGGER_ENABLED === 'true'
    : process.env.NODE_ENV !== 'production';

const customCss = `
  .swagger-ui .topbar {
    background-color: #2e1065;
    border-bottom: 2px solid #7c3aed;
    padding: 10px 0;
  }
  .swagger-ui .topbar .topbar-wrapper a {
    color: #ffffff;
    font-weight: 700;
    font-size: 1.15rem;
    display: flex;
    align-items: center;
  }
  .swagger-ui .info {
    margin: 25px 0;
  }
  .swagger-ui .info .title {
    color: #4c1d95;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .swagger-ui .btn.authorize {
    background-color: #7c3aed;
    border-color: #7c3aed;
    color: #ffffff;
  }
  .swagger-ui .btn.authorize svg {
    fill: #ffffff;
  }
  .swagger-ui .opblock.opblock-post {
    border-color: #10b981;
    background: rgba(16, 185, 129, .05);
  }
  .swagger-ui .opblock.opblock-get {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, .05);
  }
  .swagger-ui .opblock.opblock-put {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, .05);
  }
  .swagger-ui .opblock.opblock-patch {
    border-color: #8b5cf6;
    background: rgba(139, 92, 246, .05);
  }
  .swagger-ui .opblock.opblock-delete {
    border-color: #ef4444;
    background: rgba(239, 68, 68, .05);
  }
`;

const swaggerOptions = {
  customSiteTitle: 'Nura Care API Docs',
  customCss,
  customfavIcon: 'https://thenura.com/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    docExpansion: 'none',
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
  },
};

/**
 * Configure and attach Swagger UI documentation endpoints to the Express app.
 * The spec is a generated file — run `npm run swagger:generate` after
 * adding/changing routes.
 *
 * @param {import('express').Application} app
 */
export function setupSwagger(app) {
  if (!swaggerEnabled) {
    logger.info('swagger_disabled | Swagger UI off (set SWAGGER_ENABLED=true to enable)', {
      action: 'swagger_disabled',
    });
    return;
  }

  // Raw OpenAPI specification JSON endpoint for Postman / external import
  app.get('/api-docs.json', (req, res) => {
    res.json(swaggerDocument);
  });

  // Interactive Swagger UI documentation
  app.use(
    '/api-docs',
    (req, res, next) => {
      // Relax Helmet CSP specifically for Swagger UI assets and inline scripts
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Cross-Origin-Embedder-Policy');
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument, swaggerOptions),
  );
}

export { swaggerDocument };
