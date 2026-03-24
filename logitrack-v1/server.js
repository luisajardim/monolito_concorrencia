import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import db from './config/database.js';
import { initDatabase } from './database/init.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';

const require = createRequire(import.meta.url);
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize schema on startup.
initDatabase();

const app = express();

app.use(helmet());
app.use(cors());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { success: false, message: 'Muitas requisicoes. Tente novamente em 15 minutos.' },
  })
);
app.use(express.json());

// Structured request log for observability.
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration_ms: Date.now() - start,
        user: req.user?.username || 'anonymous',
      })
    );
  });

  next();
});

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LogiTrack API V1 - Monolito (SQLite / ESM)',
      version: '1.0.0',
      description: `
## LogiTrack - Plataforma de Logistica de Bairro

**Sprint 1: Monolito com SQLite e Pessimistic Locking (BEGIN IMMEDIATE)**

### Como testar o controle de concorrencia:
1. Crie um pedido como Lojista
2. Tente aceitar o mesmo pedido com multiplos tokens de Entregador simultaneamente
3. Apenas um deve ter sucesso (HTTP 200); os outros devem receber HTTP 409

### Diferenca em relacao a versao PostgreSQL:
- PostgreSQL usa \`SELECT ... FOR UPDATE\` - lock por linha
- SQLite usa \`BEGIN IMMEDIATE\` - lock por banco
- A corretude e a mesma; a granularidade e o throughput diferem
      `,
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [`${__dirname}/routes/*.js`],
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);

app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    return res.json({ status: 'healthy', database: 'sqlite', mode: 'WAL' });
  } catch {
    return res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LogiTrack V1 (SQLite/ESM) iniciado na porta ${PORT}`);
  console.log(`Docs:   http://localhost:${PORT}/docs`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

export default app;
