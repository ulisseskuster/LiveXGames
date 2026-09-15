// Suíte do InMemoryStore (padrão das demais): força o store em memória MESMO
// quando DATABASE_URL está configurada no CI. Precisa vir ANTES de qualquer
// require do app/servidor (o database.js lê o env no momento do require).
process.env.DATABASE_URL = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server } = require('../src/server');

async function subirServidor() {
  // O Socket.IO está anexado ao `server` HTTP (não ao `app`): usar app.listen
  // sobe um HTTP sem o engine.io e o cliente falha com websocket error.
  const servidor = server.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const port = servidor.address().port;
  return { servidor, url: `http://127.0.0.1:${port}` };
}

function conectar(url) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

test('chat:send respeita o rate limit por socket (5 msg / 10s) e avisa chat:rate-limited', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const socket = await conectar(url);
  t.after(() => socket.close());
  socket.emit('join-room', 'stream_room');

  // 1ª..5ª mensagens passam.
  const recebidas = new Promise((resolve) => {
    let count = 0;
    socket.on('chat:new-message', () => {
      count += 1;
      if (count === 5) resolve('recebeu 5');
    });
  });
  for (let i = 1; i <= 5; i++) {
    socket.emit('chat:send', { message: `msg ${i}` });
  }
  await recebidas;

  // 6ª mensagem é barrada com chat:rate-limited.
  const barrada = new Promise((resolve) => {
    socket.once('chat:rate-limited', (data) => resolve(data));
  });
  socket.emit('chat:send', { message: 'msg 6' });
  const aviso = await barrada;
  assert.ok(aviso.retryAfterMs > 0, 'avisa retryAfterMs');
});

test('chat:new-message só alcança sockets dentro da stream_room (sem vazamento global)', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const naSala = await conectar(url);
  const fora = await conectar(url);
  t.after(() => {
    naSala.close();
    fora.close();
  });

  // fora da sala não recebe nada
  let vazou = false;
  fora.on('chat:new-message', () => {
    vazou = true;
  });

  naSala.emit('join-room', 'stream_room');

  const recebida = new Promise((resolve) => {
    naSala.once('chat:new-message', (msg) => resolve(msg));
  });
  naSala.emit('chat:send', { message: 'oi live' });

  const msg = await recebida;
  assert.equal(msg.message, 'oi live');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(vazou, false, 'socket fora da sala não recebe chat');
});

test('join-room em sala privada de outro usuário é negado (sem vazar user_<id>)', async (t) => {
  const { servidor, url } = await subirServidor();
  t.after(() => servidor.close());

  const socket = await conectar(url);
  t.after(() => socket.close());

  // Sem autenticação, o socket não tem user; salas user_<id> exigem user.id.
  // Só o que deve funcionar sem auth é a stream_room pública.
  const negado = new Promise((resolve) => {
    // server.js registra console.warn; não emite evento de erro. Detectamos
    // pelo comportamento: se o join fosse aceito, io.to(room) alcançaria o
    // socket; então enviamos via sala alheia e conferimos que nada chega.
    socket.emit('join-room', 'user_qualquer');
    setTimeout(resolve, 120);
  });
  await negado;

  // O socket NÃO está na sala alheia: emitir em user_qualquer não o alcança.
  const recebido = new Promise((resolve) => {
    let chegou = false;
    socket.on('chat:new-message', () => {
      chegou = true;
    });
    setTimeout(() => resolve(chegou), 120);
  });
  const app = require('../src/server').app;
  app.get('io').to('user_qualquer').emit('chat:new-message', { message: 'vazou?' });
  const chegou = await recebido;
  assert.equal(chegou, false, 'socket anônimo não entra em user_<id> alheio');
});
