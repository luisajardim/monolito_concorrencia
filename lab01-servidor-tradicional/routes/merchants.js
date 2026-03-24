import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import database from '../database/database.js';
import config from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Merchants
 *     description: Endpoints para lojistas
 */

/**
 * @swagger
 * /api/merchants/register:
 *   post:
 *     summary: Cadastra um lojista
 *     tags: [Merchants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: "Loja Centro" }
 *               email: { type: string, example: "lojista@logitrack.com" }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       201: { description: Lojista cadastrado }
 */
router.post('/register', validate('registerEntity'), async (req, res) => {
	try {
		const { name, email, password } = req.body;
		const existing = database.get('SELECT id FROM merchants WHERE email = ?', [email]);
		if (existing) {
			return res.status(409).json({ success: false, message: 'Email ja cadastrado para lojista' });
		}

		const hashed = await bcrypt.hash(password, 12);
		const id = uuidv4();
		database.run('INSERT INTO merchants (id, name, email, password) VALUES (?, ?, ?, ?)', [id, name.trim(), email.toLowerCase(), hashed]);

		const token = jwt.sign({ id, role: 'merchant', email: email.toLowerCase() }, config.jwtSecret, {
			expiresIn: config.jwtExpiration
		});

		return res.status(201).json({
			success: true,
			message: 'Lojista cadastrado com sucesso',
			data: { merchant: { id, name: name.trim(), email: email.toLowerCase() }, token }
		});
	} catch {
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/merchants/me:
 *   get:
 *     summary: Retorna dados do lojista autenticado
 *     tags: [Merchants]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Perfil do lojista }
 */
router.get('/me', authMiddleware, requireRole('merchant'), (req, res) => {
	const merchant = database.get('SELECT id, name, email, createdAt FROM merchants WHERE id = ?', [req.user.id]);
	if (!merchant) {
		return res.status(404).json({ success: false, message: 'Lojista nao encontrado' });
	}
	return res.json({ success: true, data: merchant });
});

export default router;
