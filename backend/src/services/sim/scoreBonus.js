// @ts-check

// A regra é pública, mas o preço e a raridade sempre vêm do catálogo do servidor.
// Congelamos cada bônus na abertura: editar a loja não muda uma rodada já sorteada.
const PESO_RARIDADE = { common: 1, rare: 1.5, epic: 2, legendary: 3 };

function multiplicadorDoItem(item) {
  if (!item || item.type === 'cosmetic' || item.type === 'lives') return 1;
  const preco = Number(item.price);
  if (!Number.isFinite(preco) || preco <= 0) return 1;
  const peso = PESO_RARIDADE[item.rarity] || 1;
  return 1 + Math.round(Math.min(100, preco * peso) * 100) / 10000;
}

function bonusDosItens(itens) {
  const items = itens.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    price: Number(item.price),
    multiplier: multiplicadorDoItem(item)
  }));
  return {
    items,
    multiplier: Math.round(items.reduce((m, item) => m * item.multiplier, 1) * 1000000) / 1000000
  };
}

// Compatibilidade com inventários reais: preserva os IDs e traduz o catálogo
// anterior somente na fronteira com o WASM, sem alterar o motor legado.
function itemParaSimulacao(item) {
  if (item.flight_bonus?.effect) return item;
  const antigos = {
    nos_injection: {
      effect: 'boost',
      activation: 'active',
      charges: 2,
      durationTicks: 150,
      magnitude: 1.5
    },
    drift_tires: { effect: 'grip', activation: 'passive', magnitude: 1.4 },
    emp_shield: { effect: 'pulse', activation: 'active', charges: 1, magnitude: 120 },
    quantum_jump: { effect: 'teleport', activation: 'active', charges: 2, magnitude: 300 },
    plasma_shield: { effect: 'shield', activation: 'auto', charges: 1 },
    dark_matter: { effect: 'fuel_capacity', activation: 'passive', magnitude: 1.4 }
  };
  return antigos[item.id] ? { ...item, flight_bonus: antigos[item.id] } : item;
}

module.exports = { multiplicadorDoItem, bonusDosItens, itemParaSimulacao };
