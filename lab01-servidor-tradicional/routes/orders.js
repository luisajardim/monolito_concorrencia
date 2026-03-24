import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import database from '../database/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Endpoints de pedidos do LogiTrack
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Cria um novo pedido (somente lojista)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description, pickupAddress, deliveryAddress]
 *             properties:
 *               description: { type: string, example: "Entrega de documentos" }
 *               pickupAddress: { type: string, example: "Rua A, 100" }
 *               deliveryAddress: { type: string, example: "Rua B, 250" }
 *     responses:
 *       201: { description: Pedido criado }
 */
router.post('/', authMiddleware, requireRole('merchant'), validate('createOrder'), (req, res) => {
	try {
		const id = uuidv4();
		const { description, pickupAddress, deliveryAddress } = req.body;

		database.run(
			`INSERT INTO orders (id, merchantId, description, pickupAddress, deliveryAddress, status)
			 VALUES (?, ?, ?, ?, ?, 'disponivel')`,
			[id, req.user.id, description.trim(), pickupAddress.trim(), deliveryAddress.trim()]
		);

		const order = database.get('SELECT * FROM orders WHERE id = ?', [id]);
		return res.status(201).json({ success: true, data: order });
	} catch {
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/orders/available:
 *   get:
 *     summary: Lista pedidos disponiveis para aceite (somente entregador)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Lista de pedidos disponiveis }
 */
router.get('/available', authMiddleware, requireRole('courier'), (req, res) => {
	const orders = database.all(
		`SELECT o.*, m.name AS merchantName
		 FROM orders o
		 JOIN merchants m ON m.id = o.merchantId
		 WHERE o.status = 'disponivel'
		 ORDER BY o.createdAt ASC`
	);
	return res.json({ success: true, data: orders });
});

/**
 * @swagger
 * /api/orders/mine:
 *   get:
 *     summary: Lista pedidos do usuario autenticado
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Pedidos relacionados ao usuario }
 */
router.get('/mine', authMiddleware, (req, res) => {
	if (req.user.role === 'merchant') {
		const orders = database.all('SELECT * FROM orders WHERE merchantId = ? ORDER BY createdAt DESC', [req.user.id]);
		return res.json({ success: true, data: orders });
	}

	if (req.user.role === 'courier') {
		const orders = database.all('SELECT * FROM orders WHERE acceptedByCourierId = ? ORDER BY acceptedAt DESC', [req.user.id]);
		return res.json({ success: true, data: orders });
	}

	return res.status(403).json({ success: false, message: 'Perfil nao suportado' });
});

/**
 * @swagger
 * /api/orders/{id}/accept:
 *   post:
 *     summary: Aceita um pedido com locking pessimista (BEGIN IMMEDIATE)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Pedido aceito }
 *       409: { description: Pedido ja foi aceito por outro entregador }
 */
router.post('/:id/accept', authMiddleware, requireRole('courier'), (req, res) => {
	const { id } = req.params;

	try {
		const acceptedOrder = database.withImmediateTransaction(() => {
			const order = database.get('SELECT * FROM orders WHERE id = ?', [id]);
			if (!order) {
				const notFound = new Error('Pedido nao encontrado');
				notFound.statusCode = 404;
				throw notFound;
			}

			if (order.status !== 'disponivel') {
				const alreadyTaken = new Error('Pedido ja foi aceito por outro entregador');
				alreadyTaken.statusCode = 409;
				throw alreadyTaken;
			}

			const result = database.run(
				`UPDATE orders
				 SET status = 'aceito', acceptedByCourierId = ?, acceptedAt = CURRENT_TIMESTAMP
				 WHERE id = ? AND status = 'disponivel'`,
				[req.user.id, id]
			);

			if (result.changes !== 1) {
				const conflict = new Error('Pedido ja foi aceito por outro entregador');
				conflict.statusCode = 409;
				throw conflict;
			}

			database.run('UPDATE couriers SET isAvailable = 0 WHERE id = ?', [req.user.id]);
			return database.get('SELECT * FROM orders WHERE id = ?', [id]);
		});

		return res.json({
			success: true,
			message: 'Pedido aceito com sucesso',
			data: acceptedOrder
		});
	} catch (error) {
		if (error.message && error.message.includes('database is locked')) {
			return res.status(503).json({ success: false, message: 'Sistema ocupado, tente novamente' });
		}

		if (error.statusCode) {
			return res.status(error.statusCode).json({ success: false, message: error.message });
		}

		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Busca um pedido por id
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200: { description: Pedido encontrado }
 */
router.get('/:id', authMiddleware, (req, res) => {
	const order = database.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
	if (!order) {
		return res.status(404).json({ success: false, message: 'Pedido nao encontrado' });
	}

	if (req.user.role === 'merchant' && order.merchantId !== req.user.id) {
		return res.status(403).json({ success: false, message: 'Sem acesso a este pedido' });
	}

	if (req.user.role === 'courier' && order.acceptedByCourierId && order.acceptedByCourierId !== req.user.id) {
		return res.status(403).json({ success: false, message: 'Sem acesso a este pedido' });
	}

	return res.json({ success: true, data: order });
});

export default router;
