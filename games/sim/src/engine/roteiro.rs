//! Roteiro da rodada: o resultado sorteado antes de qualquer física.
//!
//! A semente vem do servidor (HMAC com chave derivada do JWT_SECRET, ver
//! backend/src/services/gameRunService.js). Duração, distância e pontos saem só
//! daqui, nos três jogos. Piloto-robô, itens, batidas e obstáculos apenas encenam
//! o filme e nunca mudam o que a rodada paga.

use super::prng::Prng;
use super::TICKS_PER_SECOND;

pub const DURACAO_MIN_TICKS: u32 = 15 * TICKS_PER_SECOND;
pub const DURACAO_MAX_TICKS: u32 = 20 * TICKS_PER_SECOND;

/// Fator de desempenho: triangular em [FATOR_MIN, FATOR_MAX], mediana e média 1.
/// backend/src/services/economy.js repete os dois limites.
pub const FATOR_MIN: f32 = 0.55;
pub const FATOR_MAX: f32 = 1.45;

/// Resolução do sorteio: soma de dois inteiros uniformes em 0..=PASSOS.
const PASSOS: u32 = 1000;

/// Frações da duração em que começam as fases 2 e 3.
const INICIO_FASE2_PCT: u32 = 35;
const INICIO_FASE3_PCT: u32 = 70;

/// Pontos por metro. O score base é o mesmo nos três jogos.
pub const PONTOS_POR_METRO: f32 = 2.0;

#[derive(Clone, Copy, Debug)]
pub struct Roteiro {
    pub duracao_ticks: u32,
    pub distancia: f32,
}

impl Roteiro {
    /// Primeira coisa que cada jogo sorteia: nada antes disto consome a semente.
    pub fn sortear(rng: &mut Prng, distancia_referencia: f32) -> Roteiro {
        let q = rng.below(PASSOS + 1) + rng.below(PASSOS + 1);
        let fator = FATOR_MIN + (FATOR_MAX - FATOR_MIN) * q as f32 / (2 * PASSOS) as f32;
        Roteiro {
            // Rodada que vai mais longe dura mais: a velocidade na tela fica
            // parecida entre rodadas boas e ruins.
            duracao_ticks: DURACAO_MIN_TICKS
                + (DURACAO_MAX_TICKS - DURACAO_MIN_TICKS) * q / (2 * PASSOS),
            distancia: distancia_referencia * fator,
        }
    }

    fn progresso(&self, tick: u32) -> f32 {
        tick.min(self.duracao_ticks) as f32 / self.duracao_ticks as f32
    }

    /// Posição no tick. Acelera de 65% a 135% da velocidade média e termina
    /// exatamente na distância sorteada.
    pub fn posicao(&self, tick: u32) -> f32 {
        if tick >= self.duracao_ticks {
            return self.distancia;
        }
        let x = self.progresso(tick);
        self.distancia * (0.65 * x + 0.35 * x * x)
    }

    /// Velocidade em m/s no tick (derivada de `posicao`).
    pub fn velocidade(&self, tick: u32) -> f32 {
        let segundos = self.duracao_ticks as f32 / TICKS_PER_SECOND as f32;
        self.distancia / segundos * (0.65 + 0.7 * self.progresso(tick))
    }

    pub fn fase(&self, tick: u32) -> u8 {
        let pct = tick.min(self.duracao_ticks) * 100 / self.duracao_ticks;
        1 + u8::from(pct >= INICIO_FASE2_PCT) + u8::from(pct >= INICIO_FASE3_PCT)
    }

    /// 0 a 100: quanto da rodada já passou.
    pub fn progresso_pct(&self, tick: u32) -> f32 {
        100.0 * self.progresso(tick)
    }

    pub fn terminou(&self, tick: u32) -> bool {
        tick >= self.duracao_ticks
    }
}
