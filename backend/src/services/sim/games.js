// @ts-check
const { TELEMETRIA_CAMPOS } = require('./simRuntime');

/**
 * Jogos da Arena: a rodada é sorteada no servidor e o navegador só reproduz o
 * filme (games/sim/src/engine/roteiro.rs). O sandbox é a fundação interativa,
 * verificada por replay do log do jogador.
 *
 * `code` e `maxTicks` repetem games/sim/src/games — backend/test/simWasm.test.js
 * confere as duas tabelas contra o .wasm publicado, então divergir quebra a suíte.
 * Os códigos de `eventos` são os EV_* de cada jogo na crate.
 */
const JOGOS = {
  sandbox: {
    code: 0,
    maxTicks: 60 * 60,
    // Prova da fundação. Nunca aparece para usuário real: em produção a rota
    // recusa como jogo inexistente.
    disponivel: () => process.env.NODE_ENV !== 'production',
    pagaMoedas: true,
    entraNoRanking: false,
    fases: { 1: 'WARMUP', 2: 'CRUISE', 3: 'RUSH' },
    eventos: {
      1: ['boost', '⚡ Boost ativado!'],
      2: ['shield_deflect', '🛡️ Escudo absorveu a batida!'],
      3: ['obstacle_hit', '⚠️ Batida no bloco!'],
      4: ['pulse', '💥 Pulso limpou a pista à frente!'],
      5: ['revive', '❤️ Segunda chance!'],
      6: ['touchdown', '🏁 Fim de partida']
    }
  },
  jet_launcher: {
    code: 1,
    maxTicks: 20 * 60,
    disponivel: () => true,
    pagaMoedas: true,
    entraNoRanking: true,
    // Os nomes de fase são os mesmos do motor antigo: o chat e o histórico já
    // os conhecem. Os nomes de evento com "nitro" e "shield" colorem os
    // marcadores de drawFlightGraph (app.js).
    fases: { 1: 'MACH_BREACH', 2: 'COMBAT_ZONE', 3: 'SUBORBITAL_CLIMB' },
    eventos: {
      1: ['roll', '🌀 Rolagem evasiva!'],
      2: ['near_miss', '💨 Passou raspando no concreto!'],
      3: ['boost_ring', '⚡ ANEL SUPERSÔNICO PERFURADO!'],
      4: ['missile_lock', '🚨 MÍSSIL TRAVANDO NO JATO!'],
      5: ['nitro_boost', '🔥 NITRO BOOSTER ATIVADO!'],
      6: ['flares', '🎆 Flares lançados: trava quebrada!'],
      7: ['drones_down', '💥 Pulso EMP derrubou os drones!'],
      8: ['shield_deflect', '🛡️ ESCUDO DEFLETOR absorveu o impacto!'],
      9: ['obstacle_hit', '⚠️ Impacto no casco!'],
      10: ['BULLET_TIME', '⏱️ BULLET-TIME: esquiva perfeita de míssil!'],
      11: ['SCRAMJET_IGNITION', '🌌 SCRAMJET ACESO: Mach 5 na estratosfera!'],
      12: ['fuel_empty', '⛽ Tanque seco!'],
      14: ['COMBAT_ZONE', '🚨 ZONA DE COMBATE: drones e mísseis no radar!'],
      15: ['SUBORBITAL_CLIMB', '🌌 SUBIDA SUBORBITAL!'],
      16: ['touchdown', '🏁 Fim de voo']
    }
  },
  neon_drifter: {
    code: 2,
    maxTicks: 20 * 60,
    disponivel: () => true,
    pagaMoedas: true,
    entraNoRanking: true,
    fases: { 1: 'NIGHT_BURNOUT', 2: 'POLICE_CHASE', 3: 'OVERDRIVE_RUSH' },
    eventos: {
      1: ['drift', '🔥 Drift carregando Neon!'],
      2: ['near_miss', '💨 Passou raspando no tráfego!'],
      3: ['nitro_boost', '⚡ Nitro Neon ativado!'],
      4: ['checkpoint', '🏁 Checkpoint alcançado!'],
      5: ['pulse', '💥 Pulso EMP abriu caminho no tráfego!'],
      6: ['crash', '💥 Batida no tráfego!'],
      7: ['police', '🚨 Polícia na cola: interceptação!'],
      8: ['overdrive', '🌈 OVERDRIVE RUSH!']
    }
  },
  void_walker: {
    code: 3,
    maxTicks: 20 * 60,
    disponivel: () => true,
    pagaMoedas: true,
    entraNoRanking: true,
    fases: { 1: 'WARP_BREACH', 2: 'ASTEROID_ZONE', 3: 'SINGULARITY_CORE' },
    eventos: {
      1: ['slingshot', '🪐 Estilingue gravitacional executado!'],
      2: ['crystal', '💠 Cristal de matéria escura coletado!'],
      3: ['nitro_jump', '🌀 Salto quântico!'],
      4: ['pulse', '💥 Pulso repulsor abriu o caminho!'],
      5: ['shield_deflect', '🛡️ Escudo de plasma absorveu o impacto!'],
      6: ['impact', '⚠️ Impacto no cinturão de asteroides!'],
      7: ['asteroid_zone', '☄️ Cinturão de asteroides à frente!'],
      8: ['horizon', '🕳️ Horizonte de eventos se aproximando!']
    }
  }
};

/** @param {string} gameId */
function jogoPorId(gameId) {
  return Object.prototype.hasOwnProperty.call(JOGOS, gameId) ? JOGOS[gameId] : null;
}

/**
 * Converte a telemetria do .wasm (amostra por segundo) no formato dos keyframes
 * do motor antigo. É o que mantém drawFlightGraph(), o histórico em
 * flight_runs.flight_script e a mensagem do chat funcionando sem reescrita.
 *
 * @param {typeof JOGOS[keyof typeof JOGOS]} jogo
 * @param {number[]} telemetria
 */
function telemetriaParaKeyframes(jogo, telemetria) {
  const keyframes = [];
  for (let i = 0; i + TELEMETRIA_CAMPOS <= telemetria.length; i += TELEMETRIA_CAMPOS) {
    const [t, fase, distancia, altitude, velocidade, combustivel, escudo, mult, evento] =
      telemetria.slice(i, i + TELEMETRIA_CAMPOS);
    const ev = jogo.eventos[evento];
    keyframes.push({
      t: Number(t.toFixed(2)),
      phase: fase,
      phaseName: jogo.fases[fase] || '',
      distance: Math.round(distancia),
      altitude: Math.round(altitude),
      speed: Math.round(velocidade),
      fuelPercent: Math.round(combustivel),
      shieldHp: escudo,
      multiplier: Number(mult.toFixed(2)),
      coinsCollected: 0,
      event: ev ? ev[0] : 'flying',
      message: ev ? ev[1] : undefined,
      bulletTime: false
    });
  }
  return keyframes;
}

module.exports = { JOGOS, jogoPorId, telemetriaParaKeyframes };
