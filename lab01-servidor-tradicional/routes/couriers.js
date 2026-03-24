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
 *   - name: Couriers
 *     description: Endpoints para entregadores
 */

/**
 * @swagger
 * /api/couriers/register:
 *   post:
 *     summary: Cadastra um entregador
 *     tags: [Couriers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: "Entregador 01" }
 *               email: { type: string, example: "entregador01@logitrack.com" }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       201: { description: Entregador cadastrado }
 */
router.post('/register', validate('registerEntity'), async (req, res) => {
	try {
		const { name, email, password } = req.body;
		const existing = database.get('SELECT id FROM couriers WHERE email = ?', [email]);
		if (existing) {
			return res.status(409).json({ success: false, message: 'Email ja cadastrado para entregador' });
		}

		const hashed = await bcrypt.hash(password, 12);
		const id = uuidv4();
		database.run('INSERT INTO couriers (id, name, email, password) VALUES (?, ?, ?, ?)', [id, name.trim(), email.toLowerCase(), hashed]);

		const token = jwt.sign({ id, role: 'courier', email: email.toLowerCase() }, config.jwtSecret, {
			expiresIn: config.jwtExpiration
		});

		return res.status(201).json({
			success: true,
			message: 'Entregador cadastrado com sucesso',
			data: { courier: { id, name: name.trim(), email: email.toLowerCase() }, token }
		});
	} catch {
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/couriers/me:
 *   get:
 *     summary: Retorna dados do entregador autenticado
 *     tags: [Couriers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Perfil do entregador }
 */
router.get('/me', authMiddleware, requireRole('courier'), (req, res) => {
	const courier = database.get('SELECT id, name, email, isAvailable, createdAt FROM couriers WHERE id = ?', [req.user.id]);
	if (!courier) {
		return res.status(404).json({ success: false, message: 'Entregador nao encontrado' });
	}
	return res.json({ success: true, data: courier });
});

export default router;
