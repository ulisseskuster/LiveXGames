//! Neon Drifter: corrida synthwave encenada sobre o roteiro sorteado.
//!
//! Distância, duração e pontos vêm de `Roteiro` (engine/roteiro.rs). Aqui só se
//! decide o que o filme mostra: faixa lateral, drift, tráfego, polícia e eventos.
//! Batida no tráfego é visual: nunca encerra a corrida nem muda o resultado.
//!
//! Layout do buffer de render espelhado em games/client/src/neon_drifter/estado.ts.

use crate::engine::hash::Fnv64;
use crate::engine::input::{Input, BTN_ACTION_A, BTN_ACTION_B, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::loadout::{Effect, Loadout};
use crate::engine::prng::Prng;
use crate::engine::roteiro::{Roteiro, DURACAO_MAX_TICKS, PONTOS_POR_METRO};
use crate::engine::{approach, DT, TICKS_PER_SECOND};

pub const MAX_TICKS: u32 = DURACAO_MAX_TICKS;
/// Distância da corrida mediana, em metros. economy.js repete (DISTANCIA_MEDIANA).
pub const DISTANCIA_REFERENCIA: f32 = 1200.0;

// ─── Eventos ───────────────────────────────────────────────────────────────
// O código é a prioridade na amostra de telemetria de cada segundo, como no Jet.
// Mensagens em backend/src/services/sim/games.js.
pub const EV_DRIFT: u32 = 1;
pub const EV_QUASE_COLISAO: u32 = 2;
pub const EV_NITRO: u32 = 3;
pub const EV_CHECKPOINT: u32 = 4;
pub const EV_PULSO: u32 = 5;
pub const EV_BATIDA: u32 = 6;
pub const EV_POLICIA: u32 = 7;
pub const EV_OVERDRIVE: u32 = 8;

// ─── Pista e carro ─────────────────────────────────────────────────────────
pub const MEIA_PISTA: f32 = 12.0;
const ALTURA_CARRO: f32 = 0.6;
const VEL_LATERAL: f32 = 18.0;
const RESPOSTA_DIRECAO: f32 = 28.0;
const LIMIAR_DRIFT: f32 = 0.18;
const NEON_POR_SEGUNDO_DE_DRIFT: f32 = 20.0;
const NEON_POR_QUASE_COLISAO: f32 = 12.0;
const NITRO_NEON_TICKS: u16 = 120;
const CHECKPOINTS: u32 = 4;

// ─── Tráfego ───────────────────────────────────────────────────────────────
pub const FAIXA_TRAFEGO: f32 = 9.0;
const VISAO: f32 = 500.0;
const ATRAS: f32 = 30.0;
const PRIMEIRO_CARRO: f32 = 90.0;
const ESPACO_MIN: f32 = 45.0;
const ESPACO_MAX: f32 = 90.0;
const BATIDA_DZ: f32 = 3.0;
const BATIDA_DX: f32 = 2.4;
const QUASE_DZ: f32 = 8.0;
const QUASE_DX: f32 = 4.0;

#[derive(Clone, Copy)]
pub struct Carro {
    pub x: f32,
    pub z: f32,
    quase: bool,
    pub batido: bool,
}

pub struct NeonDrifter {
    rng: Prng,
    pub loadout: Loadout,
    roteiro: Roteiro,
    ticks: u32,
    pub x: f32,
    pub z: f32,
    pub vx: f32,
    speed: f32,
    velocidade_max: f32,
    pub neon: f32,
    aderencia: f32,
    hull: u8,
    nitro: u16,
    checkpoint: u32,
    last_phase: u8,
    pub trafego: Vec<Carro>,
    proximo_carro: f32,
    sample_event: u32,
    frame_events: u32,
}

impl NeonDrifter {
    pub fn new(mut rng: Prng, mut loadout: Loadout) -> Self {
        let roteiro = Roteiro::sortear(&mut rng, DISTANCIA_REFERENCIA);
        let aderencia = loadout.passive_multiplier(Effect::Grip);
        Self {
            rng,
            loadout,
            roteiro,
            ticks: 0,
            x: 0.0,
            z: 0.0,
            vx: 0.0,
            speed: roteiro.velocidade(0),
            velocidade_max: 0.0,
            neon: 0.0,
            aderencia,
            hull: 3,
            nitro: 0,
            checkpoint: 0,
            last_phase: 1,
            trafego: Vec::new(),
            proximo_carro: PRIMEIRO_CARRO,
            sample_event: 0,
            frame_events: 0,
        }
    }

    fn fase(&self) -> u8 {
        self.roteiro.fase(self.ticks)
    }

    fn emit(&mut self, evento: u32) {
        self.sample_event = self.sample_event.max(evento);
        self.frame_events |= 1 << evento;
    }

    fn carregar_neon(&mut self, quanto: f32) {
        self.neon = (self.neon + quanto).min(100.0);
    }

    /// Avança um tick. Devolve true quando o roteiro da corrida terminou.
    pub fn step(&mut self, input: Input, prev: Input) -> bool {
        if self.roteiro.terminou(self.ticks) {
            return true;
        }
        if input.pressed(&prev, BTN_SWITCH_ITEM) {
            self.loadout.cycle_active();
        }
        if input.pressed(&prev, BTN_USE_ITEM) {
            self.usar_item();
        }

        let direcao = input.axis_x();
        self.vx = approach(self.vx, direcao * VEL_LATERAL, RESPOSTA_DIRECAO * DT);
        self.x = (self.x + self.vx * DT).clamp(-MEIA_PISTA, MEIA_PISTA);
        if input.held(BTN_ACTION_A) && direcao.abs() > LIMIAR_DRIFT {
            self.carregar_neon(NEON_POR_SEGUNDO_DE_DRIFT * DT * self.aderencia);
            self.emit(EV_DRIFT);
        }
        if self.neon >= 100.0 && input.pressed(&prev, BTN_ACTION_B) {
            self.neon = 0.0;
            self.nitro = NITRO_NEON_TICKS;
            self.emit(EV_NITRO);
        }
        self.nitro = self.nitro.saturating_sub(1);

        self.ticks += 1;
        // Distância e velocidade seguem o roteiro: nada na pista as altera.
        self.z = self.roteiro.posicao(self.ticks);
        self.speed = self.roteiro.velocidade(self.ticks);
        self.velocidade_max = self.velocidade_max.max(self.speed);

        while self.proximo_carro < self.z + VISAO {
            self.gerar_carro();
        }
        let limite = self.z - ATRAS;
        self.trafego.retain(|c| c.z > limite);
        self.resolver_trafego();

        let checkpoint = self.ticks * CHECKPOINTS / self.roteiro.duracao_ticks;
        if checkpoint > self.checkpoint {
            self.checkpoint = checkpoint;
            self.emit(EV_CHECKPOINT);
        }
        let fase = self.fase();
        if fase != self.last_phase {
            self.last_phase = fase;
            self.emit(if fase == 2 { EV_POLICIA } else { EV_OVERDRIVE });
        }
        self.roteiro.terminou(self.ticks)
    }

    fn usar_item(&mut self) {
        let Some(i) = self.loadout.selected_active() else {
            return;
        };
        let slot = self.loadout.slots[i];
        match slot.effect {
            Effect::Boost => {
                self.nitro = slot.duration_ticks;
                self.emit(EV_NITRO);
            }
            Effect::Pulse => {
                // Abre caminho no tráfego à frente, até o alcance do item.
                let (z, alcance) = (self.z, slot.magnitude);
                self.trafego.retain(|c| c.z <= z || c.z >= z + alcance);
                self.emit(EV_PULSO);
            }
            // Efeito que o Neon Drifter não encena: a carga não é gasta.
            _ => return,
        }
        self.loadout.consume(i);
    }

    fn gerar_carro(&mut self) {
        let x = self.rng.range_f32(-FAIXA_TRAFEGO, FAIXA_TRAFEGO);
        self.trafego.push(Carro {
            x,
            z: self.proximo_carro,
            quase: false,
            batido: false,
        });
        self.proximo_carro += self.rng.range_f32(ESPACO_MIN, ESPACO_MAX);
    }

    fn resolver_trafego(&mut self) {
        let (x, z) = (self.x, self.z);
        let (mut batidas, mut quase) = (0u32, 0u32);
        for c in self.trafego.iter_mut().filter(|c| !c.batido) {
            let (dx, dz) = ((c.x - x).abs(), (c.z - z).abs());
            if dz < BATIDA_DZ && dx < BATIDA_DX {
                c.batido = true;
                batidas += 1;
            } else if !c.quase && dz < QUASE_DZ && dx < QUASE_DX {
                // Uma vez por carro: ficar perto por mais tempo não conta de novo.
                c.quase = true;
                quase += 1;
            }
        }
        if quase > 0 {
            self.carregar_neon(NEON_POR_QUASE_COLISAO * quase as f32);
            self.emit(EV_QUASE_COLISAO);
        }
        if batidas > 0 {
            self.hull = self.hull.saturating_sub(1).max(1);
            self.emit(EV_BATIDA);
        }
    }

    pub fn distance(&self) -> f32 {
        self.z
    }

    pub fn score(&self) -> f32 {
        self.z * PONTOS_POR_METRO
    }

    /// Velocidade máxima em km/h: estatística do debrief, não entra em moeda nem pontos.
    pub fn peak(&self) -> f32 {
        self.velocidade_max * 3.6
    }

    pub fn take_sample_event(&mut self) -> u32 {
        std::mem::replace(&mut self.sample_event, 0)
    }

    /// [fase, distância, neon %, velocidade (km/h), energia %, casco, multiplicador]
    pub fn telemetry(&self, out: &mut Vec<f32>) {
        out.extend_from_slice(&[
            self.fase() as f32,
            self.z,
            self.neon,
            self.speed * 3.6,
            100.0,
            self.hull as f32,
            1.0,
        ]);
    }

    /// Cabeçalho comum de 28 campos (games/client/src/shell/cabecalho.ts) e a
    /// lista de carros: [n][x, z, batido] × n.
    pub fn render(&mut self, out: &mut Vec<f32>) {
        out.clear();
        let cargas = |i: usize| self.loadout.slots.get(i).map_or(-1.0, |s| s.charges as f32);
        out.extend_from_slice(&[
            self.x,
            ALTURA_CARRO,
            self.z,
            self.speed,
            self.hull as f32,
            100.0,
            self.fase() as f32,
            0.0,
            0.0,
            0.0,
            self.nitro as f32,
            0.0,
            1.0,
            self.vx,
            0.0,
            libm::roundf(self.score()),
            self.neon,
            self.frame_events as f32,
            self.loadout.selected_index() as f32,
            cargas(0),
            cargas(1),
            cargas(2),
            0.0,
            0.0,
            0.0,
            self.ticks as f32 / TICKS_PER_SECOND as f32,
            0.0,
            0.0,
        ]);
        self.frame_events = 0;
        out.push(self.trafego.len() as f32);
        for c in &self.trafego {
            out.extend_from_slice(&[c.x, c.z, u8::from(c.batido) as f32]);
        }
    }

    pub fn hash_into(&self, h: &mut Fnv64) {
        h.write_u32(self.ticks);
        h.write_u32(self.roteiro.duracao_ticks);
        for v in [
            self.roteiro.distancia,
            self.x,
            self.z,
            self.vx,
            self.speed,
            self.velocidade_max,
            self.neon,
            self.aderencia,
            self.proximo_carro,
        ] {
            h.write_f32(v);
        }
        h.write_u8(self.hull);
        h.write_u32(u32::from(self.nitro));
        h.write_u32(self.checkpoint);
        h.write_u32(self.trafego.len() as u32);
        for c in &self.trafego {
            h.write_f32(c.x);
            h.write_f32(c.z);
            h.write_u8(u8::from(c.quase));
            h.write_u8(u8::from(c.batido));
        }
        self.loadout.hash_into(h);
        self.rng.state_hash(h);
    }
}
