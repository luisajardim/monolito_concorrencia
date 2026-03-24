import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
	const authHeader = req.header('Authorization');

	if (!authHeader?.startsWith('Bearer ')) {
		return res.status(401).json({
			success: false,
			message: 'Token de acesso obrigatorio',
		});
	}

	const token = authHeader.replace('Bearer ', '');

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.user = decoded;
		next();
	} catch {
		return res.status(401).json({
			success: false,
			message: 'Token invalido ou expirado',
		});
	}
};

export default authMiddleware;
