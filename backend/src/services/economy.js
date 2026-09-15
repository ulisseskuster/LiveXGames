// @ts-check
/**
 * Fonte única da economia de moedas da LiveX.
 *
 * O RESULTADO da rodada (duração, distância e pontos) é sorteado pela simulação a
 * partir de uma semente HMAC do servidor (games/sim/src/engine/roteiro.rs). Nada
 * do filme — piloto, batidas, itens — muda esse resultado. Este arquivo só
 * converte o resultado em moedas.
 *
 * ANCORAGEM: a doação converte a R$ 1 = 100 moedas (COINS_PER_BRL). Uma rodada
 * mediana paga 45 moedas (R$ 0,45) em qualquer jogo. Vidas regeneram 1 a cada 8
 * horas, com reset diário ao máximo do papel (UserModel.checkAndRefillLives): um
 * viewer joga ~6 rodadas por dia ≈ 270 moedas. Um brinde de 1.500 continua
 * custando cerca de uma semana de jogo OU R$ 15 de doação.
 *
 * BASE: proporcional à distância, normalizada pela distância mediana de cada
 * jogo. O sorteio fica no fator [FATOR_MIN, FATOR_MAX], então a base de uma rodada
 * vai de 25 a 65 moedas.
 *
 * ITENS: cada consumível equipado soma `base × preço / MOEDAS_MAX_BASE` moedas
 * (arredondado para baixo). Como a base nunca passa de MOEDAS_MAX_BASE, o bônus de
 * um item nunca passa do preço dele em rodada nenhuma; na rodada mediana devolve
 * ~69% do preço. O resto do valor do item é ranking (sim/scoreBonus.js).
 */

/** Quanto paga uma rodada mediana, sem itens, em qualquer um dos jogos. */
const MOEDAS_POR_PARTIDA_MEDIANA = 45;

/** Espelham FATOR_MIN e FATOR_MAX de games/sim/src/engine/roteiro.rs. */
const FATOR_MIN = 0.55;
const FATOR_MAX = 1.45;

/**
 * Distância da rodada mediana (fator 1) de cada jogo: é o DISTANCIA_REFERENCIA de
 * cada módulo em games/sim/src/games. Normalizar por ela faz os três jogos pagarem
 * o mesmo pelo mesmo sorteio.
 */
const DISTANCIA_MEDIANA = {
  jet_launcher: 2800,
  neon_drifter: 1200,
  void_walker: 1000
};

/** A maior base que uma rodada consegue pagar. */
const MOEDAS_MAX_BASE = Math.round(MOEDAS_POR_PARTIDA_MEDIANA * FATOR_MAX);

/**
 * Converte distância em moedas-base. Estritamente proporcional: o dobro da
 * distância paga o dobro, em qualquer jogo.
 *
 * @param {string} gameId
 * @param {number} distance - distância final da rodada, em metros
 * @returns {number} moedas inteiras, no mínimo 1
 */
function coinsFromDistance(gameId, distance) {
  const referencia = DISTANCIA_MEDIANA[gameId] || DISTANCIA_MEDIANA.jet_launcher;
  const metros = Number(distance);
  if (!Number.isFinite(metros) || metros <= 0) return 1;
  return Math.max(1, Math.round((MOEDAS_POR_PARTIDA_MEDIANA * metros) / referencia));
}

/**
 * Fração da base que um item equipado soma à rodada. Cosmético e vida: 0.
 *
 * @param {{type?: string, price?: unknown} | null | undefined} item
 */
function fracaoDeMoedasDoItem(item) {
  if (!item || item.type === 'cosmetic' || item.type === 'lives') return 0;
  const preco = Number(item.price);
  if (!Number.isFinite(preco) || preco <= 0) return 0;
  return preco / MOEDAS_MAX_BASE;
}

/**
 * Moedas de uma rodada. `itens` precisa trazer o preço congelado na abertura.
 *
 * @param {string} gameId
 * @param {number} distance
 * @param {Array<{type?: string, price?: unknown}>} [itens]
 * @returns {{base: number, bonus: number, total: number}}
 */
function moedasDaRodada(gameId, distance, itens = []) {
  const base = coinsFromDistance(gameId, distance);
  const fracao = itens.reduce((soma, item) => soma + fracaoDeMoedasDoItem(item), 0);
  // min(): mesmo que algum jogo pagasse acima do teto, o item seguiria sem dar lucro.
  const bonus = Math.floor(Math.min(base, MOEDAS_MAX_BASE) * fracao);
  return { base, bonus, total: base + bonus };
}

module.exports = {
  MOEDAS_POR_PARTIDA_MEDIANA,
  FATOR_MIN,
  FATOR_MAX,
  DISTANCIA_MEDIANA,
  MOEDAS_MAX_BASE,
  coinsFromDistance,
  fracaoDeMoedasDoItem,
  moedasDaRodada
};
