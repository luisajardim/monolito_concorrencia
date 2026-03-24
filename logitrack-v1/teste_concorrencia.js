import { isMainThread, Worker, workerData, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { orderId, token, entregadorNum } = workerData;

  const options = {
    hostname: 'localhost',
    port: 3001,
    path: `/api/orders/${orderId}/accept`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': 0,
    },
  };

  const inicio = Date.now();
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      const fim = Date.now();
      try {
        const json = JSON.parse(data);
        parentPort.postMessage({
          entregador: entregadorNum,
          httpStatus: res.statusCode,
          success: json.success,
          message: json.message,
          inicio,
          fim,
          duracao_ms: fim - inicio,
        });
      } catch {
        parentPort.postMessage({ entregador: entregadorNum, erro: data });
      }
    });
  });

  req.on('error', (err) => {
    parentPort.postMessage({ entregador: entregadorNum, erro: err.message });
  });

  req.end();
}

if (isMainThread) {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Uso: node teste_concorrencia.js <ORDER_ID> <TOKEN_1> <TOKEN_2> ...');
    process.exit(1);
  }

  const orderId = args[0];
  const tokens = args.slice(1);
  const N = tokens.length;

  console.log(`\nDisparando ${N} entregadores simultaneos para o pedido ${orderId}\n`);

  let respostas = 0;
  let sucessos = 0;
  const resultados = [];

  tokens.forEach((token, i) => {
    const w = new Worker(__filename, {
      workerData: { orderId, token, entregadorNum: i + 1 },
    });

    w.on('message', (msg) => {
      resultados.push(msg);
      if (msg.success) sucessos += 1;

      console.log(
        `Entregador ${msg.entregador} | ` +
          `HTTP ${msg.httpStatus} | ` +
          `success: ${msg.success} | ` +
          `${msg.duracao_ms}ms | ` +
          `"${msg.message}"`
      );

      if (++respostas === N) {
        const minInicio = Math.min(...resultados.map((r) => r.inicio));
        const maxInicio = Math.max(...resultados.map((r) => r.inicio));

        console.log('\n-- Resumo ---------------------------------');
        console.log(`Total de entregadores : ${N}`);
        console.log(`Aceitacoes registradas: ${sucessos}`);
        console.log(`Janela de simultaneidade: ${maxInicio - minInicio}ms`);
        console.log(
          sucessos === 1
            ? 'CORRETO: exatamente 1 aceitacao - Pessimistic Locking funcionou!'
            : `BUG: ${sucessos} aceitacoes - race condition detectada!`
        );
      }
    });

    w.on('error', (err) => {
      console.error(`Worker ${i + 1} erro:`, err.message);
    });
  });
}
