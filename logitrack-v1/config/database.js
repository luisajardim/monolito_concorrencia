import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// createRequire: imports CJS modules from an ESM context.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// __dirname replacement for ESM modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, '..', 'logitrack.db'), {
	verbose: process.env.NODE_ENV === 'development' ? console.log : null,
});

// WAL allows concurrent readers while writes are happening.
db.pragma('journal_mode = WAL');

// Foreign key enforcement is disabled by default in SQLite.
db.pragma('foreign_keys = ON');

export default db;
