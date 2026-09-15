// @ts-check

/**
 * Serializa os itens equipados no formato binário que a simulação lê
 * (games/sim/src/engine/loadout.rs). Só existe no servidor: o navegador recebe os
 * bytes prontos na abertura da partida, então não há um segundo codec para
 * divergir deste.
 *
 * Esquema de `flight_bonus`:
 *   { effect, activation, charges, durationTicks, magnitude,
 *     tradeoff: { agility, topSpeed, gravityPull } }
 */

const EFEITOS = {
  boost: 1,
  shield: 2,
  fuel_capacity: 3,
  grip: 4,
  pulse: 5,
  teleport: 6,
  countermeasure: 7,
  anchor: 8,
  revive: 9
};
const ATIVACOES = { passive: 0, active: 1, auto: 2 };

const MAX_SLOTS = 3;
const SLOT_BYTES = 21;

function numero(valor, padrao, min, max, { inteiro = false, campo, itemId }) {
  const n = valor === undefined || valor === null ? padrao : Number(valor);
  const valido = Number.isFinite(n) && n >= min && n <= max && (!inteiro || Number.isInteger(n));
  if (!valido) throw new Error(`LOADOUT_INVALIDO:${itemId}:${campo}`);
  return n;
}

/** Item com efeito de partida. Cosmético e itens do esquema antigo não entram. */
function temEfeitoDePartida(item) {
  const efeito = item && item.flight_bonus && item.flight_bonus.effect;
  return typeof efeito === 'string' && Object.prototype.hasOwnProperty.call(EFEITOS, efeito);
}

/**
 * @param {Array<{id: string, flight_bonus?: any}>} itens
 * @returns {Buffer}
 */
function codificarLoadout(itens) {
  if (itens.length > MAX_SLOTS) throw new Error('INVALID_LOADOUT');
  if (itens.length === 0) return Buffer.alloc(0);

  const buf = Buffer.alloc(1 + itens.length * SLOT_BYTES);
  buf.writeUInt8(itens.length, 0);

  itens.forEach((item, i) => {
    const itemId = item.id;
    if (!temEfeitoDePartida(item)) throw new Error(`ITEM_NOT_EQUIPPABLE:${itemId}`);
    const fb = item.flight_bonus;
    const ativacao = ATIVACOES[fb.activation];
    if (ativacao === undefined) throw new Error(`LOADOUT_INVALIDO:${itemId}:activation`);
    const troca = fb.tradeoff || {};
    const o = 1 + i * SLOT_BYTES;

    buf.writeUInt8(EFEITOS[fb.effect], o);
    buf.writeUInt8(ativacao, o + 1);
    buf.writeUInt8(
      numero(fb.charges, 1, 0, 10, { inteiro: true, campo: 'charges', itemId }),
      o + 2
    );
    buf.writeUInt16LE(
      numero(fb.durationTicks, 0, 0, 3600, { inteiro: true, campo: 'durationTicks', itemId }),
      o + 3
    );
    // writeFloatLE arredonda para f32 exatamente como Math.fround, e é esse f32
    // que a crate lê: não há segunda conversão no caminho.
    buf.writeFloatLE(numero(fb.magnitude, 1, 0, 10000, { campo: 'magnitude', itemId }), o + 5);
    buf.writeFloatLE(numero(troca.agility, 0, -1, 1, { campo: 'agility', itemId }), o + 9);
    buf.writeFloatLE(numero(troca.topSpeed, 0, -1, 1, { campo: 'topSpeed', itemId }), o + 13);
    buf.writeFloatLE(numero(troca.gravityPull, 0, -1, 1, { campo: 'gravityPull', itemId }), o + 17);
  });

  return buf;
}

module.exports = { codificarLoadout, temEfeitoDePartida, EFEITOS, ATIVACOES, MAX_SLOTS };
