import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

async function postJson(url, body, token) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	});

	const payload = await response.json().catch(() => ({}));
	return { ok: response.ok, status: response.status, payload };
}

if (!isMainThread) {
	const { baseUrl, orderId, token } = workerData;
	postJson(`${baseUrl}/api/orders/${orderId}/accept`, {}, token)
		.then((result) => {
			parentPort.postMessage({
				success: result.ok,
				status: result.status,
				message: result.payload?.message
			});
		})
		.catch((error) => {
			parentPort.postMessage({ success: false, status: 500, message: error.message });
		});
} else {
	const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
	const workerCount = Number(process.env.WORKERS || 50);
	const runId = Date.now();

	console.log(`Executando teste de concorrencia com ${workerCount} entregadores...`);

	const merchantEmail = `merchant.${runId}@logitrack.dev`;
	const merchantResponse = await postJson(`${baseUrl}/api/merchants/register`, {
		name: 'Lojista Teste',
		email: merchantEmail,
		password: '123456'
	});

	if (!merchantResponse.ok) {
		throw new Error(`Falha ao criar lojista: ${JSON.stringify(merchantResponse.payload)}`);
	}

	const merchantToken = merchantResponse.payload?.data?.token;
	const orderResponse = await postJson(
		`${baseUrl}/api/orders`,
		{
			description: 'Pedido para disputa concorrente',
			pickupAddress: 'Rua Alfa, 100',
			deliveryAddress: 'Rua Beta, 200'
		},
		merchantToken
	);

	if (!orderResponse.ok) {
		throw new Error(`Falha ao criar pedido: ${JSON.stringify(orderResponse.payload)}`);
	}

	const orderId = orderResponse.payload?.data?.id;
	if (!orderId) {
		throw new Error('Pedido criado sem id');
	}

	const courierTokens = [];
	for (let i = 0; i < workerCount; i += 1) {
		const courierResponse = await postJson(`${baseUrl}/api/couriers/register`, {
			name: `Entregador ${i + 1}`,
			email: `courier.${runId}.${i}@logitrack.dev`,
			password: '123456'
		});

		if (!courierResponse.ok) {
			throw new Error(`Falha ao criar entregador ${i + 1}: ${JSON.stringify(courierResponse.payload)}`);
		}

		courierTokens.push(courierResponse.payload?.data?.token);
	}

	const outcomes = await Promise.all(
		courierTokens.map(
			(token) =>
				new Promise((resolve, reject) => {
					const worker = new Worker(new URL(import.meta.url), {
						workerData: { baseUrl, orderId, token }
					});

					worker.on('message', resolve);
					worker.on('error', reject);
					worker.on('exit', (code) => {
						if (code !== 0) reject(new Error(`Worker terminou com codigo ${code}`));
					});
				})
		)
	);

	const winners = outcomes.filter((item) => item.success === true).length;
	const conflicts = outcomes.filter((item) => item.status === 409).length;
	const busy = outcomes.filter((item) => item.status === 503).length;
	const errors = outcomes.filter((item) => !item.success && item.status !== 409 && item.status !== 503).length;

	const result = {
		orderId,
		workers: workerCount,
		winners,
		conflicts,
		busy,
		errors,
		isCorrect: winners === 1
	};

	console.log('Resultado do teste de concorrencia:');
	console.log(JSON.stringify(result, null, 2));

	if (winners !== 1) {
		process.exitCode = 1;
	}
}
