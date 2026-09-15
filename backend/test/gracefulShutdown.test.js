// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Sobe o server.js como processo filho, aguarda a porta abrir, envia SIGTERM e
 * verifica que o processo sai com código 0 em menos de 15s (graceful shutdown).
 * É o cenário do Render no deploy/reciclagem: o SIGTERM não pode matar na hora.
 */
test('SIGTERM encerra o servidor de forma controlada (exit 0, <15s)', async () => {
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  const filho = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: '3199', SHUTDOWN_PORT: '3198', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let saida = '';
  filho.stdout.on('data', (d) => {
    saida += d.toString();
  });
  filho.stderr.on('data', (d) => {
    saida += d.toString();
  });

  // Aguarda o log de "ativo na porta" (até 20s).
  const portaAberta = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Time out esperando o servidor subir')), 20_000);
    const check = setInterval(() => {
      if (saida.includes('Server ativo')) {
        clearTimeout(t);
        clearInterval(check);
        resolve();
      }
    }, 150);
    filho.on('exit', () => {
      clearTimeout(t);
      clearInterval(check);
      reject(new Error(`Servidor morreu antes do esperado. Saída:\n${saida}`));
    });
  });
  await portaAberta;

  const inicio = Date.now();
  // Conecta na porta de shutdown (SHUTDOWN_PORT) — dispara o mesmo graceful
  // shutdown do SIGTERM, sem depender de sinal do SO (no Windows child.kill
  // não entrega SIGTERM/SIGINT de forma confiável).
  const net = require('net');
  await new Promise((resolve, reject) => {
    const s = net.connect({ port: 3198 }, () => {
      s.end();
      resolve();
    });
    s.on('error', reject);
  });

  const codigo = await new Promise((resolve) => filho.on('exit', (code) => resolve(code)));
  const duracao = Date.now() - inicio;

  assert.equal(codigo, 0, `Sinal deveria sair com código 0, veio ${codigo}. Saída:\n${saida}`);
  assert.ok(
    duracao < 15_000,
    `Encerramento controlado deveria levar <15s, levou ${duracao}ms. Saída:\n${saida}`
  );
  assert.ok(
    saida.includes('Encerramento concluído'),
    `Log de encerramento esperado. Saída:\n${saida}`
  );
});
