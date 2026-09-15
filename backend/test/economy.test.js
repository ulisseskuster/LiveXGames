// @ts-check
/**
 * Invariantes da economia por sorteio. Rode com: npm run test:unit
 *
 * Travam as formas de quebrar a economia que já aconteceram neste projeto:
 *   1. moeda deixar de acompanhar o resultado (tetos por jogo apagavam a distância);
 *   2. um jogo pagar mais que outro pelo mesmo sorteio;
 *   3. item ou recarga se pagar em moeda, virando máquina de dinheiro;
 *   4. algo além da semente (piloto, item, batida) mudar o que a rodada paga.
 *
 * As rodadas saem do .wasm PUBLICADO, o mesmo que o servidor usa para sortear.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Economy = require('../src/services/economy');
const InMemoryStore = require('../src/data/store');
const { JOGOS } = require('../src/services/sim/games');
const { codificarLoadout } = require('../src/services/sim/loadoutCodec');
const { itemParaSimulacao, multiplicadorDoItem } = require('../src/services/sim/scoreBonus');
const { SimRuntime } = require('../src/services/sim/simRuntime');

const AMOSTRAS = 301;
const JOGOS_DA_ARENA = ['jet_launcher', 'neon_drifter', 'void_walker'];
const catalogo = InMemoryStore.shopItems;
const consumiveis = catalogo.filter((i) => Economy.fracaoDeMoedasDoItem(i) > 0);

/** @type {any} */
let rt;
test.before(async () => {
  rt = await SimRuntime.load();
});

const semente = (gameId, i) =>
  crypto.createHash('sha256').update(`economia-${gameId}-${i}`).digest();

function rodada(gameId, i, itens = [], botSeed = 1, skill = 1) {
  return rt.jogarComBot({
    gameCode: JOGOS[gameId].code,
    seed: semente(gameId, i),
    loadout: codificarLoadout(itens.map(itemParaSimulacao)),
    botSeed,
    skill
  }).result;
}

const mediana = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

test('a rodada mediana paga 45 moedas e dura de 15 a 20 s nos três jogos', () => {
  for (const gameId of JOGOS_DA_ARENA) {
    const resultados = Array.from({ length: AMOSTRAS }, (_, i) => rodada(gameId, i));
    const moedas = resultados.map((r) => Economy.coinsFromDistance(gameId, r.distance));
    const m = mediana(moedas);
    assert.ok(
      Math.abs(m - Economy.MOEDAS_POR_PARTIDA_MEDIANA) <= 2,
      `${gameId}: rodada mediana pagou ${m}; alvo ${Economy.MOEDAS_POR_PARTIDA_MEDIANA}`
    );
    assert.ok(Math.max(...moedas) <= Economy.MOEDAS_MAX_BASE, `${gameId}: base passou do teto`);
    for (const r of resultados) {
      assert.ok(r.ticks >= 15 * 60 && r.ticks <= 20 * 60, `${gameId}: ${r.ticks} ticks`);
    }
  }
});

test('nada além da semente muda duração, distância ou pontos', () => {
  for (const gameId of JOGOS_DA_ARENA) {
    const doJogo = consumiveis.filter((i) => i.gameId === gameId).slice(0, 3);
    for (let i = 0; i < 5; i++) {
      const base = rodada(gameId, i);
      for (const [itens, botSeed, skill] of [
        [doJogo, 99, 1],
        [doJogo.slice(0, 1), 7, 2],
        [[], 3, 0]
      ]) {
        const outra = rodada(gameId, i, /** @type {any[]} */ (itens), botSeed, skill);
        assert.deepEqual(
          [outra.ticks, outra.distance, outra.score],
          [base.ticks, base.distance, base.score],
          `${gameId}, semente ${i}, piloto ${botSeed}/${skill}`
        );
      }
    }
  }
});

test('moeda-base é proporcional à distância e igual entre jogos no mesmo fator', () => {
  for (const gameId of JOGOS_DA_ARENA) {
    const ref = Economy.DISTANCIA_MEDIANA[gameId];
    assert.equal(Economy.coinsFromDistance(gameId, ref), Economy.MOEDAS_POR_PARTIDA_MEDIANA);
    const curta = Economy.coinsFromDistance(gameId, ref * 0.6);
    const dobro = Economy.coinsFromDistance(gameId, ref * 1.2);
    assert.ok(Math.abs(dobro - curta * 2) <= 1, `${gameId}: ${curta} -> ${dobro}`);
  }
});

test('nenhum item dá lucro em moeda, em rodada nenhuma', () => {
  assert.ok(consumiveis.length >= 11, 'catálogo sem consumíveis');
  const combos = [];
  for (let a = 0; a < consumiveis.length; a++) {
    combos.push([consumiveis[a]]);
    for (let b = a + 1; b < consumiveis.length; b++) {
      combos.push([consumiveis[a], consumiveis[b]]);
      for (let c = b + 1; c < consumiveis.length; c++) {
        combos.push([consumiveis[a], consumiveis[b], consumiveis[c]]);
      }
    }
  }
  for (const gameId of JOGOS_DA_ARENA) {
    const ref = Economy.DISTANCIA_MEDIANA[gameId];
    const ate = Math.ceil(ref * Economy.FATOR_MAX);
    for (let d = Math.floor(ref * Economy.FATOR_MIN); d <= ate; d += 7) {
      const semItem = Economy.moedasDaRodada(gameId, d).total;
      for (const combo of combos) {
        const preco = combo.reduce((soma, item) => soma + item.price, 0);
        const ganho = Economy.moedasDaRodada(gameId, d, combo).total - semItem;
        if (ganho > preco) {
          assert.fail(
            `${gameId} a ${d} m: ${combo.map((i) => i.id).join('+')} rende ${ganho} e custa ${preco}`
          );
        }
      }
    }
  }
});

test('na rodada mediana o item devolve menos que o preço; o resto é ranking', () => {
  const ref = Economy.DISTANCIA_MEDIANA.neon_drifter;
  for (const item of consumiveis) {
    const ganho =
      Economy.moedasDaRodada('neon_drifter', ref, [item]).total -
      Economy.MOEDAS_POR_PARTIDA_MEDIANA;
    assert.ok(ganho > 0 && ganho < item.price, `${item.id}: ganho ${ganho}, preço ${item.price}`);
    assert.ok(multiplicadorDoItem(item) > 1, `${item.id} precisa multiplicar a pontuação`);
  }
});

test('cosmético e vida não dão moedas nem pontos', () => {
  for (const item of catalogo.filter((i) => ['cosmetic', 'lives'].includes(i.type))) {
    assert.equal(Economy.fracaoDeMoedasDoItem(item), 0, item.id);
    assert.equal(multiplicadorDoItem(item), 1, item.id);
  }
});

test('recarregar vida custa mais do que as rodadas que ela devolve', () => {
  const lifePack = catalogo.find((i) => i.id === 'life_pack');
  assert.ok(lifePack);
  const renda = lifePack.flight_bonus.extraLives * Economy.MOEDAS_MAX_BASE;
  assert.ok(
    lifePack.price > renda,
    `Bateria de Vidas custa ${lifePack.price} e devolve até ${renda} moedas-base`
  );
});
