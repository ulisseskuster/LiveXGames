// Catálogo enxuto da Arena. Itens aposentados continuam no histórico e nos
// inventários existentes, mas não podem ser vendidos nem equipados novamente.
const ITENS_POR_JOGO = Object.freeze({
  jet_launcher: ['nitro_booster', 'shield_deflector', 'extra_fuel'],
  neon_drifter: ['nos_injection', 'drift_tires', 'emp_shield'],
  void_walker: ['quantum_jump', 'plasma_shield', 'dark_matter']
});
const COMERCIALIZAVEIS = new Set([...Object.values(ITENS_POR_JOGO).flat(), 'life_pack']);
const comercializavel = (id) => COMERCIALIZAVEIS.has(id);
module.exports = { ITENS_POR_JOGO, comercializavel };
