import db from '../config/database.js';

export function initDatabase() {
	db.exec(`
		-- Usuarios: lojistas e entregadores
		CREATE TABLE IF NOT EXISTS users (
			id         TEXT PRIMARY KEY,
			email      TEXT UNIQUE NOT NULL,
			username   TEXT UNIQUE NOT NULL,
			password   TEXT NOT NULL,
			full_name  TEXT NOT NULL,
			role       TEXT NOT NULL CHECK(role IN ('lojista', 'entregador')),
			phone      TEXT,
			vehicle    TEXT,
			store_name TEXT,
			active     INTEGER DEFAULT 1,
			created_at TEXT DEFAULT (datetime('now'))
		);

		-- Pedidos de entrega
		CREATE TABLE IF NOT EXISTS orders (
			id               TEXT PRIMARY KEY,
			lojista_id       TEXT NOT NULL REFERENCES users(id),
			entregador_id    TEXT REFERENCES users(id),
			pickup_address   TEXT NOT NULL,
			delivery_address TEXT NOT NULL,
			description      TEXT NOT NULL,
			value            REAL NOT NULL,
			status           TEXT NOT NULL DEFAULT 'disponivel'
												 CHECK(status IN ('disponivel','aceito','em_transito','entregue','cancelado')),
			accepted_at      TEXT,
			delivered_at     TEXT,
			created_at       TEXT DEFAULT (datetime('now')),
			updated_at       TEXT DEFAULT (datetime('now'))
		);

		-- Historico de transicoes de status
		CREATE TABLE IF NOT EXISTS order_history (
			id         TEXT PRIMARY KEY,
			order_id   TEXT NOT NULL REFERENCES orders(id),
			status     TEXT NOT NULL,
			changed_by TEXT REFERENCES users(id),
			note       TEXT,
			created_at TEXT DEFAULT (datetime('now'))
		);

		-- Indices para performance
		CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
		CREATE INDEX IF NOT EXISTS idx_orders_lojista    ON orders(lojista_id);
		CREATE INDEX IF NOT EXISTS idx_orders_entregador ON orders(entregador_id);
		CREATE INDEX IF NOT EXISTS idx_history_order     ON order_history(order_id);
	`);

	console.log('Schema LogiTrack V1 inicializado com sucesso.');
}
