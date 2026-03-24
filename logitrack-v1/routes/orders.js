import { Router } from 'express';
import db from '../config/database.js';
import { newId } from '../config/uuid.js';
import authMiddleware from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();
router.use(authMiddleware);

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Lojista cria um novo pedido de entrega
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup_address, delivery_address, description, value]
 *             properties:
 *               pickup_address:   { type: string }
 *               delivery_address: { type: string }
 *               description:      { type: string }
 *               value:            { type: number }
 *     responses:
 *       201: { description: Pedido criado }
 *       400: { description: Campos obrigatorios ausentes }
 *       403: { description: Apenas lojistas podem criar pedidos }
 */
router.post('/', requireRole('lojista'), (req, res) => {
	const { pickup_address, delivery_address, description, value } = req.body;

	if (!pickup_address || !delivery_address || !description || !value) {
		return res.status(400).json({
			success: false,
			message: 'Campos obrigatorios: pickup_address, delivery_address, description, value',
		});
	}

	try {
		const id = newId();
		const histId = newId();

		db.prepare(`
			INSERT INTO orders (id, lojista_id, pickup_address, delivery_address, description, value)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(id, req.user.id, pickup_address, delivery_address, description, value);

		db.prepare(`
			INSERT INTO order_history (id, order_id, status, changed_by, note)
			VALUES (?, ?, 'disponivel', ?, 'Pedido criado')
		`).run(histId, id, req.user.id);

		const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

		return res.status(201).json({
			success: true,
			message: 'Pedido criado com sucesso',
			data: order,
		});
	} catch (error) {
		console.error('Erro ao criar pedido:', error);
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Lista pedidos disponiveis (entregadores) ou pedidos do lojista
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', (req, res) => {
	try {
		let rows;

		if (req.user.role === 'entregador') {
			rows = db.prepare(`
				SELECT o.*, u.store_name AS loja
				FROM orders o
				JOIN users u ON u.id = o.lojista_id
				WHERE o.status = 'disponivel'
				ORDER BY o.created_at DESC
			`).all();
		} else {
			rows = db.prepare(`
				SELECT o.*, u.full_name AS entregador_nome
				FROM orders o
				LEFT JOIN users u ON u.id = o.entregador_id
				WHERE o.lojista_id = ?
				ORDER BY o.created_at DESC
			`).all(req.user.id);
		}

		return res.json({ success: true, data: rows, count: rows.length });
	} catch (error) {
		console.error('Erro ao listar pedidos:', error);
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

/**
 * @swagger
 * /api/orders/{id}/accept:
 *   post:
 *     summary: Entregador aceita um pedido (com Pessimistic Locking)
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     description: |
 *       Controle de concorrencia via BEGIN IMMEDIATE (SQLite).
 *       Garante que apenas um entregador receba o pedido
 *       mesmo com multiplas requisicoes simultaneas.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Pedido aceito com sucesso }
 *       404: { description: Pedido nao encontrado }
 *       409: { description: Pedido nao esta mais disponivel }
 */
router.post('/:id/accept', requireRole('entregador'), (req, res) => {
	const { id } = req.params;
	const entregadorId = req.user.id;

	const acceptTransaction = db.transaction((orderId, entregId) => {
		const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

		if (!order) {
			const err = new Error('Pedido nao encontrado');
			err.statusCode = 404;
			throw err;
		}

		if (order.status !== 'disponivel') {
			const err = new Error(`Pedido nao disponivel. Status atual: ${order.status}`);
			err.statusCode = 409;
			err.currentStatus = order.status;
			throw err;
		}

		const now = new Date().toISOString();

		db.prepare(`
			UPDATE orders
			SET status = 'aceito', entregador_id = ?, accepted_at = ?, updated_at = ?
			WHERE id = ?
		`).run(entregId, now, now, orderId);

		db.prepare(`
			INSERT INTO order_history (id, order_id, status, changed_by, note)
			VALUES (?, ?, 'aceito', ?, 'Pedido aceito pelo entregador')
		`).run(newId(), orderId, entregId);

		return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
	});

	try {
		const updatedOrder = acceptTransaction(id, entregadorId);
		console.log(`Pedido ${id} aceito por ${req.user.username}`);
		return res.json({
			success: true,
			message: 'Pedido aceito com sucesso!',
			data: updatedOrder,
		});
	} catch (error) {
		return res.status(error.statusCode || 500).json({
			success: false,
			message: error.message || 'Erro interno do servidor',
			...(error.currentStatus && { current_status: error.currentStatus }),
		});
	}
});

/**
 * @swagger
 * /api/orders/{id}/status:
 *   patch:
 *     summary: Entregador atualiza o status do pedido
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [em_transito, entregue] }
 *               note:   { type: string }
 *     responses:
 *       200: { description: Status atualizado }
 *       400: { description: Transicao invalida }
 *       404: { description: Pedido nao encontrado }
 */
router.patch('/:id/status', requireRole('entregador'), (req, res) => {
	const { id } = req.params;
	const { status, note } = req.body;

	const validTransitions = {
		aceito: ['em_transito'],
		em_transito: ['entregue'],
	};

	const updateTransaction = db.transaction((orderId, novoStatus, nota, userId) => {
		const order = db.prepare('SELECT * FROM orders WHERE id = ? AND entregador_id = ?').get(orderId, userId);

		if (!order) {
			const err = new Error('Pedido nao encontrado ou nao pertence a voce');
			err.statusCode = 404;
			throw err;
		}

		if (!validTransitions[order.status]?.includes(novoStatus)) {
			const err = new Error(`Transicao invalida: ${order.status} -> ${novoStatus}`);
			err.statusCode = 400;
			throw err;
		}

		const now = new Date().toISOString();
		const deliveredAt = novoStatus === 'entregue' ? now : null;

		db.prepare(`
			UPDATE orders
			SET status = ?,
					updated_at = ?,
					delivered_at = COALESCE(?, delivered_at)
			WHERE id = ?
		`).run(novoStatus, now, deliveredAt, orderId);

		db.prepare(`
			INSERT INTO order_history (id, order_id, status, changed_by, note)
			VALUES (?, ?, ?, ?, ?)
		`).run(newId(), orderId, novoStatus, userId, nota || `Status atualizado para ${novoStatus}`);

		return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
	});

	try {
		const updated = updateTransaction(id, status, note, req.user.id);
		return res.json({ success: true, data: updated });
	} catch (error) {
		return res.status(error.statusCode || 500).json({
			success: false,
			message: error.message || 'Erro interno do servidor',
		});
	}
});

/**
 * @swagger
 * /api/orders/{id}/history:
 *   get:
 *     summary: Retorna o historico de status de um pedido
 *     tags: [Pedidos]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get('/:id/history', (req, res) => {
	try {
		const rows = db.prepare(`
			SELECT h.*, u.full_name AS changed_by_name
			FROM order_history h
			LEFT JOIN users u ON u.id = h.changed_by
			WHERE h.order_id = ?
			ORDER BY h.created_at ASC
		`).all(req.params.id);

		return res.json({ success: true, data: rows });
	} catch (error) {
		return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
	}
});

export default router;
