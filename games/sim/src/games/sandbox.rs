//! Jogo "sandbox": um bloco desviando de obstáculos numa pista reta.
//!
//! Existe para provar a fundação de ponta a ponta (WASM no navegador, log,
//! verificação no servidor, itens usados/devolvidos) antes de qualquer jogo de
//! verdade depender dela. Nunca é oferecido a usuário comum: o backend só aceita
//! `sandbox` fora de produção.

use crate::engine::hash::Fnv64;
use crate::engine::input::{Input, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::loadout::{Effect, Loadout};
use crate::engine::prng::Prng;
use crate::engine::{approach, DT};

pub const MAX_TICKS: u32 = 60 * 60;

const HALF_WIDTH: f32 = 6.0;
const PLAYER_HALF: f32 = 0.6;
const BLOCK_HALF_DEPTH: f32 = 0.8;
const ROW_SPACING: f32 = 18.0;
const VIEW_AHEAD: f32 = 140.0;
const BASE_STEER: f32 = 10.0;
const START_SPEED: f32 = 12.0;
const SPEED_GAIN: f32 = 28.0;
const SPEED_RAMP_TICKS: f32 = 2400.0;
/// Combustível base dura 50 s em velocidade de cruzeiro.
const FUEL_BURN_PER_TICK: f32 = 100.0 / (50.0 * 60.0);

pub const EVENT_NONE: u32 = 0;
pub const EVENT_BOOST: u32 = 1;
pub const EVENT_SHIELD: u32 = 2;
pub const EVENT_HIT: u32 = 3;
pub const EVENT_PULSE: u32 = 4;
pub const EVENT_REVIVE: u32 = 5;
pub const EVENT_GAME_OVER: u32 = 6;

struct Block {
    x: f32,
    z: f32,
    half_w: f32,
    alive: bool,
}

pub struct Sandbox {
    rng: Prng,
    pub loadout: Loadout,
    ticks: u32,
    x: f32,
    z: f32,
    speed: f32,
    max_speed: f32,
    hull: u8,
    fuel: f32,
    fuel_max: f32,
    agility: f32,
    boost_ticks: u16,
    boost_mag: f32,
    invuln: u16,
    next_row_z: f32,
    blocks: Vec<Block>,
    event: u32,
}

impl Sandbox {
    pub fn new(rng: Prng, mut loadout: Loadout) -> Sandbox {
        let fuel_max = 100.0 * loadout.passive_multiplier(Effect::FuelCapacity);
        let (agility_cost, _, _) = loadout.used_passive_tradeoffs();
        Sandbox {
            rng,
            loadout,
            ticks: 0,
            x: 0.0,
            z: 0.0,
            speed: START_SPEED,
            max_speed: START_SPEED,
            hull: 3,
            fuel: fuel_max,
            fuel_max,
            agility: (1.0 + agility_cost).max(0.2),
            boost_ticks: 0,
            boost_mag: 1.0,
            invuln: 0,
            next_row_z: 30.0,
            blocks: Vec::new(),
            event: EVENT_NONE,
        }
    }

    fn effective_speed(&self) -> f32 {
        if self.boost_ticks > 0 {
            self.speed * self.boost_mag
        } else {
            self.speed
        }
    }

    /// Avança um tick. Devolve true quando a partida acabou.
    pub fn step(&mut self, input: Input, prev: Input) -> bool {
        if input.pressed(&prev, BTN_SWITCH_ITEM) {
            self.loadout.cycle_active();
        }
        if input.pressed(&prev, BTN_USE_ITEM) {
            self.use_selected_item();
        }

        let target_vx = input.axis_x() * BASE_STEER * self.agility;
        self.x = (self.x + target_vx * DT).clamp(-HALF_WIDTH, HALF_WIDTH);

        let ramp = (self.ticks as f32 / SPEED_RAMP_TICKS).min(1.0);
        self.speed = approach(self.speed, START_SPEED + SPEED_GAIN * ramp, 6.0 * DT);
        let eff = self.effective_speed();
        self.max_speed = self.max_speed.max(eff);
        self.z += eff * DT;

        let burn = if self.boost_ticks > 0 { 2.0 } else { 1.0 };
        self.fuel = (self.fuel - FUEL_BURN_PER_TICK * burn).max(0.0);
        self.boost_ticks = self.boost_ticks.saturating_sub(1);

        self.spawn_rows();
        self.blocks.retain(|b| b.z > self.z - 10.0);

        if self.invuln > 0 {
            self.invuln -= 1;
        } else {
            self.resolve_collision();
        }

        self.ticks += 1;

        if self.hull == 0 {
            if let Some(idx) = self.loadout.auto_slot(Effect::Revive) {
                self.loadout.consume(idx);
                self.hull = 1;
                self.invuln = 60;
                self.event = EVENT_REVIVE;
            } else {
                self.event = EVENT_GAME_OVER;
                return true;
            }
        }
        if self.fuel <= 0.0 {
            self.event = EVENT_GAME_OVER;
            return true;
        }
        false
    }

    fn use_selected_item(&mut self) {
        let Some(idx) = self.loadout.selected_active() else {
            return;
        };
        let slot = self.loadout.slots[idx];
        match slot.effect {
            Effect::Boost => {
                self.boost_ticks = slot.duration_ticks;
                self.boost_mag = slot.magnitude;
                self.event = EVENT_BOOST;
            }
            Effect::Pulse => {
                let (from, to) = (self.z, self.z + slot.magnitude);
                for b in self.blocks.iter_mut().filter(|b| b.z > from && b.z < to) {
                    b.alive = false;
                }
                self.event = EVENT_PULSE;
            }
            // Efeito que este jogo não implementa: não gasta a carga.
            _ => return,
        }
        self.loadout.consume(idx);
    }

    fn spawn_rows(&mut self) {
        while self.next_row_z < self.z + VIEW_AHEAD {
            let n = 1 + self.rng.below(3);
            for _ in 0..n {
                let x = self.rng.range_f32(-HALF_WIDTH + 1.0, HALF_WIDTH - 1.0);
                let half_w = self.rng.range_f32(0.6, 1.6);
                self.blocks.push(Block {
                    x,
                    z: self.next_row_z,
                    half_w,
                    alive: true,
                });
            }
            self.next_row_z += ROW_SPACING * self.rng.range_f32(0.8, 1.2);
        }
    }

    fn resolve_collision(&mut self) {
        let (px, pz) = (self.x, self.z);
        let hit = self.blocks.iter_mut().find(|b| {
            b.alive
                && (b.z - pz).abs() < BLOCK_HALF_DEPTH + PLAYER_HALF
                && (b.x - px).abs() < b.half_w + PLAYER_HALF
        });
        let Some(block) = hit else {
            return;
        };
        block.alive = false;

        if let Some(idx) = self.loadout.auto_slot(Effect::Shield) {
            self.loadout.consume(idx);
            self.invuln = 30;
            self.event = EVENT_SHIELD;
        } else {
            self.hull -= 1;
            self.speed *= 0.6;
            self.invuln = 60;
            self.event = EVENT_HIT;
        }
    }

    pub fn distance(&self) -> f32 {
        self.z
    }

    pub fn score(&self) -> f32 {
        self.z * 2.0
    }

    pub fn peak(&self) -> f32 {
        self.max_speed
    }

    pub fn take_event(&mut self) -> u32 {
        std::mem::replace(&mut self.event, EVENT_NONE)
    }

    fn phase(&self) -> f32 {
        match self.ticks {
            0..=1199 => 1.0,
            1200..=2399 => 2.0,
            _ => 3.0,
        }
    }

    /// [fase, distância, altitude, velocidade, combustível %, escudo, multiplicador]
    pub fn telemetry(&self, out: &mut Vec<f32>) {
        let shield = self
            .loadout
            .auto_slot(Effect::Shield)
            .map_or(0.0, |i| self.loadout.slots[i].charges as f32);
        let mult = if self.boost_ticks > 0 {
            self.boost_mag
        } else {
            1.0
        };
        out.extend_from_slice(&[
            self.phase(),
            self.z,
            0.0,
            self.effective_speed(),
            100.0 * self.fuel / self.fuel_max,
            shield,
            mult,
        ]);
    }

    /// Layout lido por games/client/src/sandbox/scene.ts. Mudou aqui, muda lá.
    /// [x, z, velocidade, casco, combustível %, ticks de boost, invulnerável,
    ///  slot selecionado, cargas s0, s1, s2, nº de blocos, (x, z, meia-largura)*]
    pub fn render(&self, out: &mut Vec<f32>) {
        out.clear();
        let charges = |i: usize| self.loadout.slots.get(i).map_or(-1.0, |s| s.charges as f32);
        out.extend_from_slice(&[
            self.x,
            self.z,
            self.effective_speed(),
            self.hull as f32,
            100.0 * self.fuel / self.fuel_max,
            self.boost_ticks as f32,
            self.invuln as f32,
            self.loadout.selected_index() as f32,
            charges(0),
            charges(1),
            charges(2),
            0.0,
        ]);
        let count_at = out.len() - 1;
        let mut count = 0.0;
        for b in self.blocks.iter().filter(|b| b.alive) {
            out.extend_from_slice(&[b.x, b.z, b.half_w]);
            count += 1.0;
        }
        out[count_at] = count;
    }

    pub fn hash_into(&self, h: &mut Fnv64) {
        h.write_u32(self.ticks);
        for v in [self.x, self.z, self.speed, self.fuel, self.boost_mag] {
            h.write_f32(v);
        }
        h.write_u8(self.hull);
        h.write_u32(self.boost_ticks as u32);
        h.write_u32(self.invuln as u32);
        h.write_u32(self.blocks.len() as u32);
        for b in &self.blocks {
            h.write_f32(b.x);
            h.write_f32(b.z);
            h.write_f32(b.half_w);
            h.write_u8(b.alive as u8);
        }
        self.loadout.hash_into(h);
        self.rng.state_hash(h);
    }
}
