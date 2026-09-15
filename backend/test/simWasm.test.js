const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');

const { SimRuntime, SIM_WASM_PATH, lerManifesto } = require('../src/services/sim/simRuntime');
const { JOGOS } = require('../src/services/sim/games');
const { codificarLoadout } = require('../src/services/sim/loadoutCodec');
const RunVerifier = require('../src/services/sim/runVerifier');

/**
 * Garantias da fundação vistas do Node, sobre o .wasm PUBLICADO — o mesmo
 * arquivo que o navegador baixa e que o verificador usa em produção.
 */

let rt;
test.before(async () => {
  rt = await SimRuntime.load();
});
test.after(() => RunVerifier.encerrar());

const semente = (i) => crypto.createHash('sha256').update(`teste-${i}`).digest();

/**
 * Reescreve o varint final (tick de fim) de um log. Só é seguro com o bot
 * aleatório, que nunca mexe no eixo Y: com eixo Y negativo, o byte anterior ao
 * varint teria o bit alto ligado e se confundiria com ele.
 */
function trocarTickFinal(log, novoTick) {
  let inicio = log.length - 1;
  while (inicio > 0 && log[inicio - 1] & 0x80) inicio--;
  const varint = [];
  let n = novoTick;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    varint.push(byte);
  } while (n);
  return Buffer.concat([log.subarray(0, inicio), Buffer.from(varint)]);
}

test('o manifesto publicado descreve o .wasm publicado', () => {
  const manifesto = lerManifesto();
  assert.ok(manifesto, 'frontend/public/games/sim-manifest.json ausente: rode npm run games:build');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(SIM_WASM_PATH)).digest('hex');
  assert.equal(manifesto.sha256, sha);
  assert.equal(manifesto.simVersion, rt.version);
});

test('a tabela de jogos do backend bate com a da crate', () => {
  for (const [id, jogo] of Object.entries(JOGOS)) {
    assert.equal(rt.maxTicks(jogo.code), jogo.maxTicks, `${id}: maxTicks divergente`);
  }
  assert.equal(rt.maxTicks(99), 0, 'código de jogo inexistente precisa dar 0');
});

test('replay de uma partida legítima reproduz resultado, hash e telemetria', () => {
  for (let i = 0; i < 10; i++) {
    const partida = rt.jogarComBot({ gameCode: 0, seed: semente(i), botSeed: i + 1 });
    const replay = rt.replay({
      gameCode: 0,
      seed: semente(i),
      loadout: Buffer.alloc(0),
      log: partida.log
    });
    assert.equal(replay.ok, true, `partida ${i}: ${replay.error}`);
    assert.deepEqual(replay.result, partida.result);
    assert.deepEqual(replay.telemetry, partida.telemetry);
  }
});

test('log adulterado ou de outra partida não passa', () => {
  const partida = rt.jogarComBot({ gameCode: 0, seed: semente(1), botSeed: 5 });
  assert.equal(partida.result.endReason, 'game_over');
  const base = { gameCode: 0, seed: semente(1), loadout: Buffer.alloc(0) };

  const truncado = rt.replay({ ...base, log: partida.log.subarray(0, partida.log.length - 1) });
  assert.deepEqual([truncado.ok, truncado.error], [false, 'BAD_LOG']);

  const sobrando = rt.replay({ ...base, log: Buffer.concat([partida.log, Buffer.from([0])]) });
  assert.deepEqual([sobrando.ok, sobrando.error], [false, 'BAD_LOG']);

  // "Durei mais do que durei": a simulação acaba antes do tick declarado.
  const esticado = trocarTickFinal(partida.log, partida.result.ticks + 30);
  const esticadoReplay = rt.replay({ ...base, log: esticado });
  assert.deepEqual([esticadoReplay.ok, esticadoReplay.error], [false, 'END_MISMATCH']);

  const alemDoLimite = trocarTickFinal(partida.log, JOGOS.sandbox.maxTicks + 1);
  assert.equal(rt.replay({ ...base, log: alemDoLimite }).error, 'LOG_EXCEEDS_MAX_TICKS');

  // O log de uma pista aplicado a outra semente não reproduz o mesmo resultado.
  const outraPista = rt.replay({ ...base, seed: semente(2), log: partida.log });
  assert.ok(!outraPista.ok || outraPista.result.hash !== partida.result.hash);
});

test('sair no meio vale só o que foi percorrido até ali', () => {
  const partida = rt.jogarComBot({ gameCode: 0, seed: semente(3), botSeed: 9, sairNoTick: 120 });
  assert.equal(partida.result.endReason, 'quit');
  assert.equal(partida.result.ticks, 120);
  const replay = rt.replay({
    gameCode: 0,
    seed: semente(3),
    loadout: Buffer.alloc(0),
    log: partida.log
  });
  assert.deepEqual(replay.result, partida.result);
});

test('codec de loadout: item de partida entra, cosmético e número fora da faixa não', () => {
  const escudo = {
    id: 'escudo',
    flight_bonus: { effect: 'shield', activation: 'auto', charges: 1 }
  };
  const loadout = codificarLoadout([escudo]);
  assert.equal(loadout.length, 1 + 21);

  const partida = rt.jogarComBot({ gameCode: 0, seed: semente(4), loadout, botSeed: 2 });
  const replay = rt.replay({ gameCode: 0, seed: semente(4), loadout, log: partida.log });
  assert.deepEqual(replay.result, partida.result);

  assert.throws(
    () => codificarLoadout([{ id: 'hangar', flight_bonus: { scoreMultiplier: 1.5 } }]),
    /ITEM_NOT_EQUIPPABLE:hangar/
  );
  assert.throws(
    () =>
      codificarLoadout([
        { id: 'x', flight_bonus: { effect: 'boost', activation: 'active', charges: 2.5 } }
      ]),
    /LOADOUT_INVALIDO:x:charges/
  );
  assert.throws(
    () => codificarLoadout([{ id: 'y', flight_bonus: { effect: 'boost', activation: 'sempre' } }]),
    /LOADOUT_INVALIDO:y:activation/
  );
  assert.throws(() => codificarLoadout([escudo, escudo, escudo, escudo]), /INVALID_LOADOUT/);
});

test('o verificador em worker_thread chega ao mesmo resultado e mede o custo', async () => {
  const partida = rt.jogarComBot({ gameCode: 0, seed: semente(6), botSeed: 11 });
  const verificacao = await RunVerifier.verificar({
    gameCode: 0,
    seed: semente(6),
    loadout: Buffer.alloc(0),
    log: partida.log
  });
  assert.equal(verificacao.ok, true);
  assert.deepEqual(verificacao.result, partida.result);
  assert.equal(verificacao.simVersion, rt.version);
  assert.ok(verificacao.ms < 1000, `verificação levou ${verificacao.ms} ms`);
});
