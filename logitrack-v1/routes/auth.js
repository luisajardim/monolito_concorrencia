import { createRequire } from 'module';
import { Router } from 'express';
import db from '../config/database.js';
import { newId } from '../config/uuid.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registra um novo usuario (lojista ou entregador)
 *     tags: [Autenticacao]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, username, password, full_name, role]
 *             properties:
 *               email:      { type: string }
 *               username:   { type: string }
 *               password:   { type: string }
 *               full_name:  { type: string }
 *               role:       { type: string, enum: [lojista, entregador] }
 *               phone:      { type: string }
 *               vehicle:    { type: string, description: "Apenas entregador" }
 *               store_name: { type: string, description: "Apenas lojista" }
 *     responses:
 *       201: { description: Usuario criado }
 *       400: { description: Campos invalidos }
 *       409: { description: Email ou username ja cadastrado }
 */
router.post('/register', async (req, res) => {
	const { email, username, password, full_name, role, phone, vehicle, store_name } = req.body;

	if (!email || !username || !password || !full_name || !role) {
		return res.status(400).json({
			success: false,
			message: 'Campos obrigatorios: email, username, password, full_name, role',
		});
	}

	if (!['lojista', 'entregador'].includes(role)) {
		return res.status(400).json({
			success: false,
			message: 'Role deve ser: lojista ou entregador',
		});
	}

	try {
		const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);

		if (existing) {
			return res.status(409).json({
				success: false,
				message: 'Email ou username ja cadastrado',
			});
		}

		const hashedPassword = await bcrypt.hash(password, 12);
		const id = newId();

		db.prepare(`
			INSERT INTO users (id, email, username, password, full_name, role, phone, vehicle, store_name)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(id, email, username, hashedPassword, full_name, role, phone ?? null, vehicle ?? null, store_name ?? null);

		const user = db.prepare('SELECT id, email, username, full_name, role, created_at FROM users WHERE id = ?').get(id);

		return res.status(201).json({
			success: true,
			message: 'Usuario registrado com sucesso',
			data: user,
		});
	} catch (error) {
		console.error('Erro no registro:', error);
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Autentica o usuario e retorna um JWT
 *     tags: [Autenticacao]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login realizado, token retornado }
 *       401: { description: Credenciais invalidas }
 */
router.post('/login', async (req, res) => {
	const { email, password } = req.body;

	if (!email || !password) {
		return res.status(400).json({
			success: false,
			message: 'Email e senha sao obrigatorios',
		});
	}

	try {
		const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);

		// Same error text for unknown user and wrong password to avoid account enumeration.
		if (!user) {
			return res.status(401).json({ success: false, message: 'Credenciais invalidas' });
		}

		const validPassword = await bcrypt.compare(password, user.password);

		if (!validPassword) {
			return res.status(401).json({ success: false, message: 'Credenciais invalidas' });
		}

		const token = jwt.sign(
			{ id: user.id, email: user.email, username: user.username, role: user.role },
			process.env.JWT_SECRET,
			{ expiresIn: '24h' }
		);

		const { password: _password, ...userWithoutPassword } = user;

		return res.json({
			success: true,
			message: 'Login realizado com sucesso',
			data: { token, user: userWithoutPassword },
		});
	} catch (error) {
		console.error('Erro no login:', error);
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

export default router;
