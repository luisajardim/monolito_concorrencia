const express = require('express');
const User = require('../models/User');
const database = require('../database/database');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Requer autenticação para todas as rotas
router.use(authMiddleware);

// Obter dados do usuário autenticado
router.get('/me', async (req, res) => {
    try {
        const row = await database.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

        if (!row) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
        }

        const user = new User(row);
        res.json({ success: true, data: user.toJSON() });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

// Atualizar dados básicos do usuário
router.put('/me', validate('userUpdate'), async (req, res) => {
    try {
        const updates = req.body;

        if (!Object.keys(updates).length) {
            return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
        }

        // Garantir unicidade de email/username
        if (updates.email || updates.username) {
            const conflict = await database.get(
                'SELECT id FROM users WHERE (email = ? AND email IS NOT NULL) OR (username = ? AND username IS NOT NULL)',
                [updates.email || null, updates.username || null]
            );

            if (conflict && conflict.id !== req.user.id) {
                return res.status(409).json({ success: false, message: 'Email ou username já existe' });
            }
        }

        // Preparar campos dinamicamente
        const fields = [];
        const params = [];

        if (updates.email) {
            fields.push('email = ?');
            params.push(updates.email);
        }
        if (updates.username) {
            fields.push('username = ?');
            params.push(updates.username);
        }
        if (updates.firstName) {
            fields.push('firstName = ?');
            params.push(updates.firstName);
        }
        if (updates.lastName) {
            fields.push('lastName = ?');
            params.push(updates.lastName);
        }

        if (!fields.length) {
            return res.status(400).json({ success: false, message: 'Nenhum campo válido para atualizar' });
        }

        params.push(req.user.id);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        const result = await database.run(sql, params);

        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
        }

        const updatedRow = await database.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const user = new User(updatedRow);

        res.json({ success: true, message: 'Usuário atualizado com sucesso', data: user.toJSON() });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

module.exports = router;
