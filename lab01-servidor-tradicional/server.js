const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config/database');
const database = require('./database/database');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const userRoutes = require('./routes/users');

/**
 * Servidor de Aplicação Tradicional
 *
 * Implementa arquitetura cliente-servidor conforme Coulouris et al. (2012):
 * - Centralização do estado da aplicação
 * - Comunicação Request-Reply via HTTP
 * - Processamento síncrono das requisições
 */

const app = express();

// Middleware de segurança
app.use(helmet());
app.use(rateLimit(config.rateLimit));
app.use(cors());

// Parsing de dados
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Logging simples de requisições
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Rotas principais
app.get('/', (req, res) => {
    res.json({
        service: 'Task Management API',
        version: '1.0.0',
        architecture: 'Traditional Client-Server',
        endpoints: {
            auth: ['POST /api/auth/register', 'POST /api/auth/login'],
            users: ['GET /api/users/me', 'PUT /api/users/me'],
            tasks: ['GET /api/tasks', 'POST /api/tasks', 'PUT /api/tasks/:id', 'DELETE /api/tasks/:id']
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint não encontrado'
    });
});

// Error handler global
app.use((error, req, res, next) => {
    console.error('Erro:', error);
    res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
    });
});

// Inicialização
async function startServer() {
    try {
        await database.init();

        app.listen(config.port, () => {
            console.log('🚀 =================================');
            console.log(`🚀 Servidor iniciado na porta ${config.port}`);
            console.log(`🚀 URL: http://localhost:${config.port}`);
            console.log(`🚀 Health: http://localhost:${config.port}/health`);
            console.log('🚀 =================================');
        });
    } catch (error) {
        console.error('❌ Falha na inicialização:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = app;
