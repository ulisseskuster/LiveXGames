//! Void Walker: expedição espacial encenada sobre o roteiro sorteado.
//!
//! Distância, duração e pontos vêm de `Roteiro` (engine/roteiro.rs). Aqui só se
//! decide o que o filme mostra: manobras, planetas, asteroides, cristais e a
//! aproximação da singularidade. Impacto é visual: nunca encerra a expedição nem
//! muda o resultado.
//!
//! Layout do buffer de render espelhado em games/client/src/void_walker/estado.ts.

use crate::engine::hash::Fnv64;
use crate::engine::input::{Input, BTN_ACTION_A, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::loadout::{Effect, Loadout};
use crate::engine::prng::Prng;
use crate::engine::roteiro::{Roteiro, DURACAO_MAX_TICKS, PONTOS_POR_METRO};
use crate::engine::{approach, DT, TICKS_PER_SECOND};

pub const MAX_TICKS: u32 = DURACAO_MAX_TICKS;
/// Distância da expedição mediana. economy.js repete (DISTANCIA_MEDIANA).
pub const DISTANCIA_REFERENCIA: f32 = 1000.0;

// ─── Eventos ───────────────────────────────────────────────────────────────
// O código é a prioridade na amostra de telemetria de cada segundo, como no Jet.
// Mensagens em backend/src/services/sim/games.js.
pub const EV_ESTILINGUE: u32 = 1;
pub const EV_CRISTAL: u32 = 2;
pub const EV_SALTO: u32 = 3;
pub const EV_PULSO: u32 = 4;
pub const EV_ESCUDO: u32 = 5;
pub const EV_IMPACTO: u32 = 6;
pub const EV_CINTURAO: u32 = 7;
pub const EV_HORIZONTE: u32 = 8;

// ─── Nave ──────────────────────────────────────────────────────────────────
pub const MEIA_LARGURA: f32 = 38.0;
pub const ALTURA_MIN: f32 = 5.0;
pub const ALTURA_MAX: f32 = 95.0;
const ALTURA_INICIAL: f32 = 18.0;
const VEL_LATERAL: f32 = 25.0;
const VEL_VERTICAL: f32 = 22.0;
const RESPOSTA: f32 = 18.0;
const OSCILACAO_ANCORA: f32 = 0.8;
const ESTILINGUE_TICKS: u16 = 90;
const EMPURRAO_PLANETA: f32 = 8.0;
const RAIO_NAVE: f32 = 2.4;
const RAIO_CRISTAL: f32 = 12.0;
const ENERGIA_POR_CRISTAL: f32 = 2.0;
const DRENO_ENERGIA_POR_SEGUNDO: f32 = 2.0;

// ─── Espaço ────────────────────────────────────────────────────────────────
const BLOCO: f32 = 180.0;
const VISAO: f32 = 450.0;
const ATRAS: f32 = 30.0;
const PRIMEIRO_BLOCO: f32 = 100.0;
const CHANCE_PLANETA_PCT: u32 = 65;

#[derive(Clone, Copy)]
pub struct Planeta {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub r: f32,
    pub massa: f32,
}

#[derive(Clone, Copy)]
pub struct Asteroide {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub r: f32,
    cristal: bool,
    vivo: bool,
}

pub struct VoidWalker {
    rng: Prng,
    pub loadout: Loadout,
    roteiro: Roteiro,
    ticks: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vx: f32,
    pub vy: f32,
    speed: f32,
    energia: f32,
    hull: u8,
    estilingue: u16,
    cristais: u32,
    last_phase: u8,
    pub planetas: Vec<Planeta>,
    pub asteroides: Vec<Asteroide>,
    proximo_bloco: f32,
    sample_event: u32,
    frame_events: u32,
}

impl VoidWalker {
    pub fn new(mut rng: Prng, loadout: Loadout) -> Self {
        let roteiro = Roteiro::sortear(&mut rng, DISTANCIA_REFERENCIA);
        Self {
            rng,
            loadout,
            roteiro,
            ticks: 0,
            x: 0.0,
            y: ALTURA_INICIAL,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            speed: roteiro.velocidade(0),
            energia: 100.0,
            hull: 3,
            estilingue: 0,
            cristais: 0,
            last_phase: 1,
            planetas: Vec::new(),
            asteroides: Vec::new(),
            proximo_bloco: PRIMEIRO_BLOCO,
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

    /// Avança um tick. Devolve true quando o roteiro da expedição terminou.
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

        self.vx = approach(self.vx, input.axis_x() * VEL_LATERAL, RESPOSTA * DT);
        self.vy = approach(self.vy, input.axis_y() * VEL_VERTICAL, RESPOSTA * DT);
        if input.held(BTN_ACTION_A) {
            // Âncora gravitacional: a nave oscila presa ao campo e dispara o estilingue.
            let t = self.ticks as f32;
            self.vx += libm::sinf(t * 0.035) * OSCILACAO_ANCORA;
            self.vy += libm::cosf(t * 0.029) * OSCILACAO_ANCORA;
            self.estilingue = self.estilingue.saturating_add(1);
            if self.estilingue % ESTILINGUE_TICKS == 0 {
                self.emit(EV_ESTILINGUE);
            }
        } else {
            self.estilingue = 0;
        }
        self.x = (self.x + self.vx * DT).clamp(-MEIA_LARGURA, MEIA_LARGURA);
        self.y = (self.y + self.vy * DT).clamp(ALTURA_MIN, ALTURA_MAX);

        self.ticks += 1;
        // Distância e velocidade seguem o roteiro: nada no espaço as altera.
        self.z = self.roteiro.posicao(self.ticks);
        self.speed = self.roteiro.velocidade(self.ticks);
        self.energia = (self.energia - DRENO_ENERGIA_POR_SEGUNDO * DT).max(0.0);

        while self.proximo_bloco < self.z + VISAO {
            self.gerar_bloco();
        }
        let limite = self.z - ATRAS;
        self.asteroides.retain(|a| a.vivo && a.z > limite);
        self.planetas.retain(|p| p.z + p.r > limite);
        self.resolver();

        let fase = self.fase();
        if fase != self.last_phase {
            self.last_phase = fase;
            self.emit(if fase == 2 { EV_CINTURAO } else { EV_HORIZONTE });
        }
        self.roteiro.terminou(self.ticks)
    }

    fn usar_item(&mut self) {
        let Some(i) = self.loadout.selected_active() else {
            return;
        };
        let slot = self.loadout.slots[i];
        match slot.effect {
            // O salto aparece no filme; a distância continua sendo a do roteiro.
            Effect::Teleport => self.emit(EV_SALTO),
            Effect::Pulse => {
                let (x, y, alcance) = (self.x, self.y, slot.magnitude);
                self.asteroides.retain(|a| {
                    let (dx, dy) = (a.x - x, a.y - y);
                    dx * dx + dy * dy >= alcance * alcance
                });
                self.emit(EV_PULSO);
            }
            Effect::Anchor => {
                self.estilingue = ESTILINGUE_TICKS;
                self.emit(EV_ESTILINGUE);
            }
            // Efeito que o Void Walker não encena: a carga não é gasta.
            _ => return,
        }
        self.loadout.consume(i);
    }

    fn gerar_bloco(&mut self) {
        let z0 = self.proximo_bloco;
        let rng = &mut self.rng;
        if rng.below(100) < CHANCE_PLANETA_PCT {
            self.planetas.push(Planeta {
                x: rng.range_f32(-25.0, 25.0),
                y: rng.range_f32(20.0, 80.0),
                z: z0,
                r: rng.range_f32(7.0, 16.0),
                massa: rng.range_f32(1.0, 3.0),
            });
        }
        for _ in 0..(2 + rng.below(4)) {
            self.asteroides.push(Asteroide {
                x: rng.range_f32(-MEIA_LARGURA, MEIA_LARGURA),
                y: rng.range_f32(8.0, 90.0),
                z: z0 + rng.range_f32(0.0, BLOCO),
                r: rng.range_f32(1.5, 4.0),
                cristal: false,
                vivo: true,
            });
        }
        self.proximo_bloco += BLOCO;
    }

    fn resolver(&mut self) {
        let (x, y, z) = (self.x, self.y, self.z);

        let mut puxao = (0.0f32, 0.0f32);
        for p in &self.planetas {
            if (p.z - z).abs() >= p.r + 4.0 {
                continue;
            }
            let (dx, dy) = (p.x - x, p.y - y);
            let alcance = p.r + 3.0;
            if dx * dx + dy * dy < alcance * alcance {
                puxao.0 += dx.signum() * EMPURRAO_PLANETA;
                puxao.1 += dy.signum() * EMPURRAO_PLANETA;
            }
        }
        if puxao != (0.0, 0.0) {
            self.vx += puxao.0;
            self.vy += puxao.1;
            self.emit(EV_ESTILINGUE);
        }

        let (mut impactos, mut cristais) = (0u32, 0u32);
        for a in self.asteroides.iter_mut().filter(|a| a.vivo) {
            let (dx, dy, dz) = (a.x - x, a.y - y, a.z - z);
            let d2 = dx * dx + dy * dy + dz * dz;
            let raio = a.r + RAIO_NAVE;
            if d2 < raio * raio {
                a.vivo = false;
                impactos += 1;
            } else if !a.cristal && d2 < RAIO_CRISTAL * RAIO_CRISTAL {
                // Uma vez por asteroide: ficar perto por mais tempo não conta de novo.
                a.cristal = true;
                cristais += 1;
            }
        }
        if cristais > 0 {
            self.cristais += cristais;
            self.energia = (self.energia + ENERGIA_POR_CRISTAL * cristais as f32).min(100.0);
            self.emit(EV_CRISTAL);
        }
        if impactos > 0 {
            if let Some(i) = self.loadout.auto_slot(Effect::Shield) {
                self.loadout.consume(i);
                self.emit(EV_ESCUDO);
            } else {
                self.hull = self.hull.saturating_sub(1).max(1);
                self.emit(EV_IMPACTO);
            }
        }
    }

    pub fn distance(&self) -> f32 {
        self.z
    }

    pub fn score(&self) -> f32 {
        self.z * PONTOS_POR_METRO
    }

    /// Cristais coletados: estatística do debrief, não entra em moeda nem pontos.
    pub fn peak(&self) -> f32 {
        self.cristais as f32
    }

    pub fn take_sample_event(&mut self) -> u32 {
        std::mem::replace(&mut self.sample_event, 0)
    }

    /// [fase, distância, altura, velocidade (km/h), energia %, casco, multiplicador]
    pub fn telemetry(&self, out: &mut Vec<f32>) {
        out.extend_from_slice(&[
            self.fase() as f32,
            self.z,
            self.y,
            self.speed * 3.6,
            self.energia,
            self.hull as f32,
            1.0,
        ]);
    }

    /// Cabeçalho comum de 28 campos (games/client/src/shell/cabecalho.ts), a lista
    /// de asteroides [n][x, y, z, r] × n e a de planetas [n][x, y, z, r, massa] × n.
    pub fn render(&mut self, out: &mut Vec<f32>) {
        out.clear();
        let cargas = |i: usize| self.loadout.slots.get(i).map_or(-1.0, |s| s.charges as f32);
        out.extend_from_slice(&[
            self.x,
            self.y,
            self.z,
            self.speed,
            self.hull as f32,
            self.energia,
            self.fase() as f32,
            0.0,
            0.0,
            0.0,
            self.estilingue as f32,
            0.0,
            1.0,
            self.vx,
            self.vy,
            libm::roundf(self.score()),
            self.roteiro.progresso_pct(self.ticks),
            self.frame_events as f32,
            self.loadout.selected_index() as f32,
            cargas(0),
            cargas(1),
            cargas(2),
            self.y,
            0.0,
            0.0,
            self.ticks as f32 / TICKS_PER_SECOND as f32,
            0.0,
            0.0,
        ]);
        self.frame_events = 0;
        out.push(self.asteroides.len() as f32);
        for a in &self.asteroides {
            out.extend_from_slice(&[a.x, a.y, a.z, a.r]);
        }
        out.push(self.planetas.len() as f32);
        for p in &self.planetas {
            out.extend_from_slice(&[p.x, p.y, p.z, p.r, p.massa]);
        }
    }

    pub fn hash_into(&self, h: &mut Fnv64) {
        h.write_u32(self.ticks);
        h.write_u32(self.roteiro.duracao_ticks);
        for v in [
            self.roteiro.distancia,
            self.x,
            self.y,
            self.z,
            self.vx,
            self.vy,
            self.speed,
            self.energia,
            self.proximo_bloco,
        ] {
            h.write_f32(v);
        }
        h.write_u8(self.hull);
        h.write_u32(u32::from(self.estilingue));
        h.write_u32(self.cristais);
        h.write_u32(self.planetas.len() as u32);
        for p in &self.planetas {
            for v in [p.x, p.y, p.z, p.r, p.massa] {
                h.write_f32(v);
            }
        }
        h.write_u32(self.asteroides.len() as u32);
        for a in &self.asteroides {
            for v in [a.x, a.y, a.z, a.r] {
                h.write_f32(v);
            }
            h.write_u8(u8::from(a.cristal));
        }
        self.loadout.hash_into(h);
        self.rng.state_hash(h);
    }
}
