//! Jet Launcher: voo em trilho com liberdade no plano.
//!
//! Distância, duração e pontos vêm do roteiro sorteado da semente
//! (engine/roteiro.rs). O jato avança pelo eixo Z exatamente como o roteiro manda;
//! o piloto-robô controla X (lateral) e Y (altura), rola e usa itens só para o
//! filme. Batida, combustível e itens nunca encerram a rodada nem mudam o que
//! ela paga.
//!
//! Tudo é gerado pela semente em blocos de 200 m à frente do jato: a mesma
//! semente monta a mesma cidade no navegador e no verificador.

use crate::engine::hash::Fnv64;
use crate::engine::input::{Input, BTN_ACTION_A, BTN_ACTION_B, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::loadout::{Effect, Loadout};
use crate::engine::prng::Prng;
use crate::engine::roteiro::{Roteiro, DURACAO_MAX_TICKS, PONTOS_POR_METRO};
use crate::engine::{approach, DT};

pub const MAX_TICKS: u32 = DURACAO_MAX_TICKS;
/// Distância do voo mediano, em metros. economy.js repete (DISTANCIA_MEDIANA).
pub const DISTANCIA_REFERENCIA: f32 = 2800.0;

// ─── Corredor de voo ───────────────────────────────────────────────────────
pub const HALF_WIDTH: f32 = 42.0;
pub const FLOOR_Y: f32 = 4.0;
pub const CEILING_Y: f32 = 110.0;
pub const PLANE_RADIUS: f32 = 2.4;

// ─── Mundo ─────────────────────────────────────────────────────────────────
const CHUNK: f32 = 200.0;
pub const VIEW_AHEAD: f32 = 1000.0;
const DESPAWN_BEHIND: f32 = 60.0;
/// Primeiros metros sem obstáculo: a decolagem não pode começar dentro de um prédio.
const RUNWAY: f32 = 260.0;

// ─── Dinâmica ──────────────────────────────────────────────────────────────
pub const MAX_LATERAL: f32 = 42.0;
pub const MAX_VERTICAL: f32 = 36.0;
const CONTROL_RESPONSE: f32 = 140.0;
/// Ar rarefeito na subida suborbital: o jato responde menos.
const THIN_AIR_CONTROL: f32 = 0.8;

// ─── Combustível (só HUD e filme) ──────────────────────────────────────────
const FUEL_BASE: f32 = 100.0;
const FUEL_BURN: f32 = FUEL_BASE / 60.0;
const THROTTLE_BURN: f32 = 1.8;
const THIN_AIR_BURN: f32 = 1.5;
const RING_FUEL: [f32; 3] = [4.0, 4.0, 6.0];
const NITRO_FUEL_COST: f32 = 4.0;

// ─── Manobras e impactos ───────────────────────────────────────────────────
const ROLL_TICKS: u16 = 18;
const ROLL_COOLDOWN: u16 = 90;
const ROLL_IMPULSE: f32 = 26.0;
const HIT_INVULN: u16 = 90;
const SHIELD_INVULN: u16 = 45;
const RING_BOOST_TICKS: u16 = 60;
const BULLET_TIME_TICKS: u16 = 75;
/// Durante o bullet-time o mundo anda a 35%; o controle do jogador, não.
pub const BULLET_TIME_SCALE: f32 = 0.35;
const NEAR_MISS_GAP: f32 = 5.0;

// ─── Ameaças ───────────────────────────────────────────────────────────────
const DRONE_RADIUS: f32 = 3.0;
const MISSILE_RADIUS: f32 = 2.0;
const MISSILE_START: f32 = 650.0;
const MISSILE_WARN_TICKS: u16 = 80;
const MISSILE_SPEED: f32 = 170.0;
const MISSILE_ACCEL: f32 = 40.0;
/// Rolando com o míssil passando a menos disto: esquiva perfeita.
const PERFECT_DODGE_RADIUS: f32 = 12.0;
const SCRAMJET_ALTITUDE: f32 = 20_000.0;

// ─── Origem dos impactos (diagnóstico) ─────────────────────────────────────
pub const HIT_PREDIO: usize = 0;
pub const HIT_DRONE: usize = 1;
pub const HIT_MISSIL: usize = 2;
pub const HIT_DETRITO: usize = 3;
pub const HIT_CHAO: usize = 4;

// ─── Eventos ───────────────────────────────────────────────────────────────
// O código é também a prioridade: na amostra de telemetria de cada segundo fica
// o evento mais importante, não o último. Mensagens em
// backend/src/services/sim/games.js.
pub const EV_ROLL: u32 = 1;
pub const EV_NEAR_MISS: u32 = 2;
pub const EV_RING: u32 = 3;
pub const EV_MISSILE_LOCK: u32 = 4;
pub const EV_NITRO: u32 = 5;
pub const EV_FLARES: u32 = 6;
pub const EV_DRONES_DOWN: u32 = 7;
pub const EV_SHIELD: u32 = 8;
pub const EV_HIT: u32 = 9;
pub const EV_PERFECT_DODGE: u32 = 10;
pub const EV_SCRAMJET: u32 = 11;
pub const EV_FUEL_EMPTY: u32 = 12;
pub const EV_PHASE_COMBAT: u32 = 14;
pub const EV_PHASE_SUBORBITAL: u32 = 15;
pub const EV_FIM: u32 = 16;

#[derive(Clone, Copy)]
pub struct Building {
    pub x: f32,
    pub z: f32,
    pub hw: f32,
    pub hd: f32,
    pub h: f32,
    near_miss_done: bool,
}

#[derive(Clone, Copy)]
pub struct Ring {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub r: f32,
    pub passed: bool,
}

#[derive(Clone, Copy)]
pub struct Drone {
    pub cx: f32,
    pub y: f32,
    pub z: f32,
    pub amp: f32,
    pub freq: f32,
    pub phase: f32,
    pub alive: bool,
    near_miss_done: bool,
}

impl Drone {
    /// Posição lateral no tempo de mundo. Seno da crate libm: o mesmo resultado
    /// no navegador, no Node e no teste nativo.
    pub fn x_at(&self, world_time: f32) -> f32 {
        self.cx + self.amp * libm::sinf(self.freq * world_time + self.phase)
    }
}

#[derive(Clone, Copy)]
pub struct Missile {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vx: f32,
    pub vy: f32,
    /// Ticks de aviso de trava antes do disparo.
    pub warn: u16,
    pub locked: bool,
    pub alive: bool,
    prev_rel: f32,
}

#[derive(Clone, Copy)]
pub struct Debris {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub r: f32,
}

pub struct JetLauncher {
    rng: Prng,
    pub loadout: Loadout,
    roteiro: Roteiro,
    pub ticks: u32,
    pub world_time: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vx: f32,
    pub vy: f32,
    pub speed: f32,
    climb: f32,
    max_altitude: f32,
    pub hull: u8,
    pub fuel: f32,
    pub fuel_max: f32,
    agility: f32,
    pub roll_ticks: u16,
    pub roll_cooldown: u16,
    invuln: u16,
    boost_ticks: u16,
    boost_mag: f32,
    ring_boost: u16,
    bullet_time: u16,
    flares_ticks: u16,
    last_phase: u8,
    scramjet_done: bool,
    next_chunk_z: f32,
    next_missile_id: u32,
    pub buildings: Vec<Building>,
    pub rings: Vec<Ring>,
    pub drones: Vec<Drone>,
    pub missiles: Vec<Missile>,
    pending_missiles: Vec<f32>,
    pub debris: Vec<Debris>,
    rings_collected: u32,
    near_misses: u32,
    perfect_dodges: u32,
    kills: u32,
    sample_event: u32,
    frame_events: u32,
    /// Impactos por origem (HIT_*), absorvidos pelo escudo ou não.
    pub hits_by: [u32; 5],
}

impl JetLauncher {
    pub fn new(mut rng: Prng, mut loadout: Loadout) -> JetLauncher {
        let roteiro = Roteiro::sortear(&mut rng, DISTANCIA_REFERENCIA);
        let fuel_max = FUEL_BASE * loadout.passive_multiplier(Effect::FuelCapacity);
        let (agility_cost, _, _) = loadout.used_passive_tradeoffs();
        JetLauncher {
            rng,
            loadout,
            roteiro,
            ticks: 0,
            world_time: 0.0,
            x: 0.0,
            y: 40.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            speed: roteiro.velocidade(0),
            climb: 0.0,
            max_altitude: 40.0,
            hull: 3,
            fuel: fuel_max,
            fuel_max,
            agility: (1.0 + agility_cost).max(0.3),
            roll_ticks: 0,
            roll_cooldown: 0,
            invuln: 0,
            boost_ticks: 0,
            boost_mag: 1.0,
            ring_boost: 0,
            bullet_time: 0,
            flares_ticks: 0,
            last_phase: 1,
            scramjet_done: false,
            next_chunk_z: RUNWAY,
            next_missile_id: 1,
            buildings: Vec::new(),
            rings: Vec::new(),
            drones: Vec::new(),
            missiles: Vec::new(),
            pending_missiles: Vec::new(),
            debris: Vec::new(),
            rings_collected: 0,
            near_misses: 0,
            perfect_dodges: 0,
            kills: 0,
            sample_event: 0,
            frame_events: 0,
            hits_by: [0; 5],
        }
    }

    pub fn phase(&self) -> u8 {
        self.roteiro.fase(self.ticks)
    }

    pub fn altitude(&self) -> f32 {
        self.y + self.climb
    }

    fn vulnerable(&self) -> bool {
        self.invuln == 0 && self.roll_ticks == 0
    }

    fn emit(&mut self, event: u32) {
        self.sample_event = self.sample_event.max(event);
        self.frame_events |= 1 << event;
    }

    /// Avança um tick. Devolve true quando o roteiro da rodada terminou.
    pub fn step(&mut self, input: Input, prev: Input) -> bool {
        if self.roteiro.terminou(self.ticks) {
            return true;
        }

        let phase = self.phase();
        if phase != self.last_phase {
            self.last_phase = phase;
            self.emit(if phase == 2 {
                EV_PHASE_COMBAT
            } else {
                EV_PHASE_SUBORBITAL
            });
        }

        if input.pressed(&prev, BTN_SWITCH_ITEM) {
            self.loadout.cycle_active();
        }
        if input.pressed(&prev, BTN_USE_ITEM) {
            self.use_selected_item();
        }

        self.update_roll(input, prev);

        let time_scale = if self.bullet_time > 0 {
            BULLET_TIME_SCALE
        } else {
            1.0
        };
        let world_dt = DT * time_scale;
        self.world_time += world_dt;

        self.update_controls(input, phase);
        // Distância e velocidade seguem o roteiro: nada no voo as altera.
        self.z = self.roteiro.posicao(self.ticks + 1);
        self.speed = self.roteiro.velocidade(self.ticks + 1);
        if phase == 3 {
            self.climb += self.speed * world_dt * 0.12;
        }
        self.max_altitude = self.max_altitude.max(self.altitude());

        if !self.scramjet_done && self.altitude() >= SCRAMJET_ALTITUDE {
            self.scramjet_done = true;
            self.emit(EV_SCRAMJET);
        }

        self.update_fuel(input, phase);

        if self.y < FLOOR_Y {
            // Raspou no chão: o jato quica de volta para o ar.
            self.y = FLOOR_Y + 6.0;
            self.vy = 18.0;
            if self.vulnerable() {
                self.hit(HIT_CHAO);
            }
        }

        while self.next_chunk_z < self.z + VIEW_AHEAD {
            self.spawn_chunk();
        }
        self.activate_missiles();
        self.despawn();

        self.collect_rings();
        self.resolve_buildings();
        self.resolve_drones();
        self.resolve_missiles(world_dt);
        self.resolve_debris();

        self.invuln = self.invuln.saturating_sub(1);
        self.boost_ticks = self.boost_ticks.saturating_sub(1);
        self.ring_boost = self.ring_boost.saturating_sub(1);
        self.bullet_time = self.bullet_time.saturating_sub(1);
        self.flares_ticks = self.flares_ticks.saturating_sub(1);
        self.ticks += 1;

        if self.roteiro.terminou(self.ticks) {
            self.emit(EV_FIM);
            return true;
        }
        false
    }

    fn update_roll(&mut self, input: Input, prev: Input) {
        self.roll_ticks = self.roll_ticks.saturating_sub(1);
        self.roll_cooldown = self.roll_cooldown.saturating_sub(1);
        if self.roll_cooldown > 0 || !input.pressed(&prev, BTN_ACTION_A) {
            return;
        }
        self.roll_ticks = ROLL_TICKS;
        self.roll_cooldown = ROLL_COOLDOWN;
        // A rolagem empurra para o lado do manche; sem manche, para o lado em que
        // o jato já deslizava.
        let dir = if input.ax != 0 {
            (input.ax as f32).signum()
        } else if self.vx != 0.0 {
            self.vx.signum()
        } else {
            1.0
        };
        self.vx += dir * ROLL_IMPULSE;
        self.emit(EV_ROLL);
    }

    fn update_controls(&mut self, input: Input, phase: u8) {
        let air = if phase == 3 { THIN_AIR_CONTROL } else { 1.0 };
        let agility = self.agility * air;
        let tx = input.axis_x() * MAX_LATERAL * agility;
        let ty = input.axis_y() * MAX_VERTICAL * agility;
        let response = CONTROL_RESPONSE * agility * DT;
        // Durante a rolagem o impulso lateral vale inteiro: não é freado pelo manche.
        if self.roll_ticks == 0 {
            self.vx = approach(self.vx, tx, response);
        }
        self.vy = approach(self.vy, ty, response);

        self.x += self.vx * DT;
        if self.x.abs() > HALF_WIDTH {
            self.x = self.x.clamp(-HALF_WIDTH, HALF_WIDTH);
            self.vx = 0.0;
        }
        self.y += self.vy * DT;
        if self.y > CEILING_Y {
            self.y = CEILING_Y;
            self.vy = self.vy.min(0.0);
        }
    }

    /// Combustível só aparece no HUD e no filme: secar o tanque não encerra a rodada.
    fn update_fuel(&mut self, input: Input, phase: u8) {
        if self.fuel <= 0.0 {
            return;
        }
        let mut burn = FUEL_BURN * DT;
        if input.held(BTN_ACTION_B) {
            burn *= THROTTLE_BURN;
        }
        if phase == 3 {
            burn *= THIN_AIR_BURN;
        }
        self.fuel -= burn;
        if self.fuel <= 0.0 {
            self.fuel = 0.0;
            self.boost_ticks = 0;
            self.emit(EV_FUEL_EMPTY);
        }
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
                self.fuel = (self.fuel - NITRO_FUEL_COST).max(0.0);
                self.emit(EV_NITRO);
            }
            Effect::Countermeasure => {
                for m in self.missiles.iter_mut().filter(|m| m.alive) {
                    m.locked = false;
                }
                self.flares_ticks = 30;
                self.emit(EV_FLARES);
            }
            Effect::Pulse => {
                let (px, pz, reach, wt) = (self.x, self.z, slot.magnitude, self.world_time);
                let mut abatidos = 0;
                for d in self.drones.iter_mut().filter(|d| d.alive) {
                    if d.z > pz && d.z < pz + reach && (d.x_at(wt) - px).abs() < 60.0 {
                        d.alive = false;
                        abatidos += 1;
                    }
                }
                self.kills += abatidos;
                self.emit(EV_DRONES_DOWN);
            }
            // Efeito que o Jet Launcher não encena: a carga não é gasta.
            _ => return,
        }
        self.loadout.consume(idx);
    }

    /// Impacto só visual: o casco nunca chega a zero e a rodada segue o roteiro.
    fn hit(&mut self, fonte: usize) {
        self.hits_by[fonte] += 1;
        if let Some(idx) = self.loadout.auto_slot(Effect::Shield) {
            self.loadout.consume(idx);
            self.invuln = SHIELD_INVULN;
            self.emit(EV_SHIELD);
            return;
        }
        self.hull = self.hull.saturating_sub(1).max(1);
        self.invuln = HIT_INVULN;
        self.emit(EV_HIT);
    }

    fn spawn_chunk(&mut self) {
        let z0 = self.next_chunk_z;
        let phase = self.phase();
        let rng = &mut self.rng;

        if phase < 3 {
            // Faixa livre: toda seção de cidade tem por onde passar. Os prédios que
            // caem nela saem baixos, e o anel mora dentro dela.
            let gap_x = rng.range_f32(-HALF_WIDTH + 12.0, HALF_WIDTH - 12.0);
            let n = 2 + rng.below(2);
            for _ in 0..n {
                let z = z0 + rng.range_f32(0.0, CHUNK);
                let hw = rng.range_f32(5.0, 11.0);
                let hd = rng.range_f32(6.0, 14.0);
                let x = rng.range_f32(-HALF_WIDTH - 20.0, HALF_WIDTH + 20.0);
                // Uns 25% passam do teto útil: muralhas que obrigam a contornar.
                let mut h = rng.range_f32(15.0, 135.0);
                if (x - gap_x).abs() < hw + 10.0 {
                    h = h.min(rng.range_f32(8.0, 30.0));
                }
                self.buildings.push(Building {
                    x,
                    z,
                    hw,
                    hd,
                    h,
                    near_miss_done: false,
                });
            }
            self.rings.push(Ring {
                x: gap_x + rng.range_f32(-6.0, 6.0),
                y: rng.range_f32(34.0, 80.0),
                z: z0 + rng.range_f32(60.0, 160.0),
                r: 7.0,
                passed: false,
            });

            if phase == 2 {
                if rng.below(100) < 60 {
                    let k = 2 + rng.below(3);
                    let cx = rng.range_f32(-28.0, 28.0);
                    let y = rng.range_f32(30.0, 80.0);
                    let z = z0 + rng.range_f32(40.0, 180.0);
                    let amp = rng.range_f32(6.0, 14.0);
                    let freq = rng.range_f32(1.2, 2.2);
                    for i in 0..k {
                        self.drones.push(Drone {
                            cx: cx + (i as f32 - (k - 1) as f32 / 2.0) * 9.0,
                            y: y + (i % 2) as f32 * 6.0,
                            z: z + i as f32 * 4.0,
                            amp,
                            freq,
                            phase: i as f32 * 0.8,
                            alive: true,
                            near_miss_done: false,
                        });
                    }
                }
                if rng.below(100) < 32 {
                    self.pending_missiles
                        .push(z0 + rng.range_f32(0.0, CHUNK) - MISSILE_START);
                }
            }
        } else {
            let n = 3 + rng.below(3);
            for _ in 0..n {
                self.debris.push(Debris {
                    x: rng.range_f32(-HALF_WIDTH, HALF_WIDTH),
                    y: rng.range_f32(10.0, 90.0),
                    z: z0 + rng.range_f32(0.0, CHUNK),
                    r: rng.range_f32(2.5, 5.0),
                });
            }
            if rng.below(100) < 55 {
                self.rings.push(Ring {
                    x: rng.range_f32(-HALF_WIDTH + 8.0, HALF_WIDTH - 8.0),
                    y: rng.range_f32(20.0, 85.0),
                    z: z0 + rng.range_f32(40.0, 180.0),
                    r: 8.0,
                    passed: false,
                });
            }
            if rng.below(100) < 20 {
                self.pending_missiles
                    .push(z0 + rng.range_f32(0.0, CHUNK) - MISSILE_START);
            }
        }
        self.next_chunk_z += CHUNK;
    }

    fn activate_missiles(&mut self) {
        // Os gatilhos são criados em ordem crescente de Z, bloco a bloco.
        while self.pending_missiles.first().is_some_and(|&z| z <= self.z) {
            self.pending_missiles.remove(0);
            let id = self.next_missile_id;
            self.next_missile_id += 1;
            let x = self.rng.range_f32(-30.0, 30.0);
            let y = self.rng.range_f32(25.0, 80.0);
            self.missiles.push(Missile {
                id,
                x,
                y,
                z: self.z + MISSILE_START,
                vx: 0.0,
                vy: 0.0,
                warn: MISSILE_WARN_TICKS,
                locked: true,
                alive: true,
                prev_rel: MISSILE_START,
            });
            self.emit(EV_MISSILE_LOCK);
        }
    }

    fn despawn(&mut self) {
        let limit = self.z - DESPAWN_BEHIND;
        self.buildings.retain(|b| b.z + b.hd > limit);
        self.rings.retain(|r| r.z > limit);
        self.drones.retain(|d| d.z > limit);
        self.missiles.retain(|m| m.alive);
        self.debris.retain(|d| d.z > limit);
    }

    fn collect_rings(&mut self) {
        let (px, py, pz) = (self.x, self.y, self.z);
        let phase = self.phase() as usize;
        let mut ganhos = 0;
        for ring in self.rings.iter_mut().filter(|r| !r.passed) {
            if (ring.z - pz).abs() > 3.0 {
                continue;
            }
            ring.passed = true;
            let dx = ring.x - px;
            let dy = ring.y - py;
            if dx * dx + dy * dy < ring.r * ring.r {
                ganhos += 1;
            }
        }
        for _ in 0..ganhos {
            self.rings_collected += 1;
            self.fuel = (self.fuel + RING_FUEL[phase - 1]).min(self.fuel_max);
            self.ring_boost = RING_BOOST_TICKS;
            self.emit(EV_RING);
        }
    }

    fn resolve_buildings(&mut self) {
        let (px, py, pz) = (self.x, self.y, self.z);
        let vulnerable = self.vulnerable();
        let mut bateu = false;
        let mut quase = 0;
        for b in self.buildings.iter_mut() {
            if (b.z - pz).abs() >= b.hd + PLANE_RADIUS {
                continue;
            }
            let gap_x = (b.x - px).abs() - b.hw - PLANE_RADIUS;
            let gap_y = py - b.h - PLANE_RADIUS;
            if gap_x < 0.0 && gap_y < 0.0 {
                if vulnerable {
                    bateu = true;
                }
            } else if !b.near_miss_done
                && gap_x < NEAR_MISS_GAP
                && gap_y < NEAR_MISS_GAP
                && (b.z - pz).abs() < b.hd
            {
                b.near_miss_done = true;
                quase += 1;
            }
        }
        if bateu {
            self.hit(HIT_PREDIO);
        }
        self.add_near_misses(quase);
    }

    fn add_near_misses(&mut self, n: u32) {
        if n == 0 {
            return;
        }
        self.near_misses += n;
        self.emit(EV_NEAR_MISS);
    }

    fn resolve_drones(&mut self) {
        let (px, py, pz, wt) = (self.x, self.y, self.z, self.world_time);
        let vulnerable = self.vulnerable();
        let hit_r = DRONE_RADIUS + PLANE_RADIUS;
        let miss_r = hit_r + NEAR_MISS_GAP;
        let mut bateu = false;
        let mut quase = 0;
        for d in self.drones.iter_mut().filter(|d| d.alive) {
            let dz = d.z - pz;
            if dz.abs() > miss_r {
                continue;
            }
            let dx = d.x_at(wt) - px;
            let dy = d.y - py;
            let dist2 = dx * dx + dy * dy + dz * dz;
            if dist2 < hit_r * hit_r {
                if vulnerable && !bateu {
                    bateu = true;
                    d.alive = false;
                }
            } else if dist2 < miss_r * miss_r && !d.near_miss_done {
                d.near_miss_done = true;
                quase += 1;
            }
        }
        if bateu {
            self.hit(HIT_DRONE);
        }
        self.add_near_misses(quase);
    }

    fn resolve_missiles(&mut self, world_dt: f32) {
        let (px, py, pz) = (self.x, self.y, self.z);
        let vulnerable = self.vulnerable();
        let rolling = self.roll_ticks > 0;
        let mut bateu = false;
        let mut esquivas = 0;
        for m in self.missiles.iter_mut().filter(|m| m.alive) {
            if m.warn > 0 {
                // Travando: acompanha o jato à distância, e o jogador vê o aviso.
                m.warn -= 1;
                m.z = pz + MISSILE_START;
                m.prev_rel = MISSILE_START;
                continue;
            }
            m.z -= MISSILE_SPEED * world_dt;
            if m.locked {
                let ax = ((px - m.x) * 3.0 - m.vx * 1.6).clamp(-MISSILE_ACCEL, MISSILE_ACCEL);
                let ay = ((py - m.y) * 3.0 - m.vy * 1.6).clamp(-MISSILE_ACCEL, MISSILE_ACCEL);
                m.vx += ax * world_dt;
                m.vy += ay * world_dt;
            }
            m.x += m.vx * world_dt;
            m.y += m.vy * world_dt;

            let rel = m.z - pz;
            // Míssil e jato se aproximam a vários metros por tick: a colisão é
            // conferida no cruzamento, não só quando os dois estão no mesmo ponto.
            if m.prev_rel > 0.0 && rel <= 0.0 {
                m.alive = false;
                let dx = m.x - px;
                let dy = m.y - py;
                let lat2 = dx * dx + dy * dy;
                let hit_r = MISSILE_RADIUS + PLANE_RADIUS;
                if lat2 < hit_r * hit_r && vulnerable {
                    bateu = true;
                } else if rolling && lat2 < PERFECT_DODGE_RADIUS * PERFECT_DODGE_RADIUS {
                    esquivas += 1;
                }
            }
            m.prev_rel = rel;
        }
        if bateu {
            self.hit(HIT_MISSIL);
        }
        if esquivas > 0 {
            self.perfect_dodges += esquivas;
            self.bullet_time = BULLET_TIME_TICKS;
            self.emit(EV_PERFECT_DODGE);
        }
    }

    fn resolve_debris(&mut self) {
        let (px, py, pz) = (self.x, self.y, self.z);
        if !self.vulnerable() {
            return;
        }
        let bateu = self.debris.iter().any(|d| {
            let r = d.r + PLANE_RADIUS;
            let (dx, dy, dz) = (d.x - px, d.y - py, d.z - pz);
            dz.abs() < r && dx * dx + dy * dy + dz * dz < r * r
        });
        if bateu {
            self.hit(HIT_DETRITO);
        }
    }

    pub fn distance(&self) -> f32 {
        self.z
    }

    pub fn score(&self) -> f32 {
        self.z * PONTOS_POR_METRO
    }

    /// Altitude máxima: estatística do debrief, não entra em moeda nem pontos.
    pub fn peak(&self) -> f32 {
        self.max_altitude
    }

    pub fn missile_warning(&self) -> u32 {
        self.missiles
            .iter()
            .filter(|m| m.alive && (m.warn > 0 || m.z - self.z < 400.0))
            .count() as u32
    }

    pub fn take_sample_event(&mut self) -> u32 {
        std::mem::replace(&mut self.sample_event, 0)
    }

    /// [fase, distância, altitude, velocidade (km/h), combustível %, escudo, multiplicador]
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
            self.phase() as f32,
            self.z,
            self.altitude(),
            self.speed * 3.6,
            100.0 * self.fuel / self.fuel_max,
            shield,
            mult,
        ]);
    }

    /// Layout lido por games/client/src/jet_launcher/estado.ts (cabeçalho comum em
    /// games/client/src/shell/cabecalho.ts). Mudou aqui, muda lá.
    pub fn render(&mut self, out: &mut Vec<f32>) {
        out.clear();
        let charges = |i: usize| self.loadout.slots.get(i).map_or(-1.0, |s| s.charges as f32);
        out.extend_from_slice(&[
            self.x,
            self.y,
            self.z,
            self.speed,
            self.hull as f32,
            100.0 * self.fuel / self.fuel_max,
            self.phase() as f32,
            self.roll_ticks as f32,
            self.roll_cooldown as f32,
            self.invuln as f32,
            self.boost_ticks as f32,
            self.bullet_time as f32,
            if self.bullet_time > 0 {
                BULLET_TIME_SCALE
            } else {
                1.0
            },
            self.vx,
            self.vy,
            libm::roundf(self.score()),
            self.rings_collected as f32,
            self.frame_events as f32,
            self.loadout.selected_index() as f32,
            charges(0),
            charges(1),
            charges(2),
            self.altitude(),
            self.missile_warning() as f32,
            0.0,
            self.world_time,
            self.ring_boost as f32,
            self.flares_ticks as f32,
        ]);
        self.frame_events = 0;

        let (from, to) = (self.z - DESPAWN_BEHIND, self.z + VIEW_AHEAD);
        let count_at = out.len();
        out.push(0.0);
        for b in self.buildings.iter().filter(|b| b.z > from && b.z < to) {
            out.extend_from_slice(&[b.x, b.z, b.hw, b.hd, b.h]);
            out[count_at] += 1.0;
        }
        let count_at = out.len();
        out.push(0.0);
        for r in self.rings.iter().filter(|r| r.z > from && r.z < to) {
            out.extend_from_slice(&[r.x, r.y, r.z, r.r, r.passed as u8 as f32]);
            out[count_at] += 1.0;
        }
        let count_at = out.len();
        out.push(0.0);
        for d in self
            .drones
            .iter()
            .filter(|d| d.alive && d.z > from && d.z < to)
        {
            out.extend_from_slice(&[d.x_at(self.world_time), d.y, d.z]);
            out[count_at] += 1.0;
        }
        let count_at = out.len();
        out.push(0.0);
        for m in self.missiles.iter().filter(|m| m.alive) {
            out.extend_from_slice(&[
                m.x,
                m.y,
                m.z,
                (m.warn > 0) as u8 as f32,
                m.locked as u8 as f32,
            ]);
            out[count_at] += 1.0;
        }
        let count_at = out.len();
        out.push(0.0);
        for d in self.debris.iter().filter(|d| d.z > from && d.z < to) {
            out.extend_from_slice(&[d.x, d.y, d.z, d.r]);
            out[count_at] += 1.0;
        }
    }

    pub fn hash_into(&self, h: &mut Fnv64) {
        h.write_u32(self.ticks);
        h.write_u32(self.roteiro.duracao_ticks);
        for v in [
            self.roteiro.distancia,
            self.world_time,
            self.x,
            self.y,
            self.z,
            self.vx,
            self.vy,
            self.speed,
            self.climb,
            self.fuel,
            self.boost_mag,
            self.next_chunk_z,
        ] {
            h.write_f32(v);
        }
        h.write_u8(self.hull);
        for v in [
            self.roll_ticks,
            self.roll_cooldown,
            self.invuln,
            self.boost_ticks,
            self.ring_boost,
            self.bullet_time,
            self.flares_ticks,
        ] {
            h.write_u32(v as u32);
        }
        for v in [
            self.rings_collected,
            self.near_misses,
            self.perfect_dodges,
            self.kills,
        ] {
            h.write_u32(v);
        }
        for v in self.hits_by {
            h.write_u32(v);
        }
        h.write_u32(self.buildings.len() as u32);
        for b in &self.buildings {
            for v in [b.x, b.z, b.hw, b.hd, b.h] {
                h.write_f32(v);
            }
            h.write_u8(b.near_miss_done as u8);
        }
        h.write_u32(self.rings.len() as u32);
        for r in &self.rings {
            for v in [r.x, r.y, r.z, r.r] {
                h.write_f32(v);
            }
            h.write_u8(r.passed as u8);
        }
        h.write_u32(self.drones.len() as u32);
        for d in &self.drones {
            for v in [d.cx, d.y, d.z, d.amp, d.freq, d.phase] {
                h.write_f32(v);
            }
            h.write_u8(d.alive as u8);
        }
        h.write_u32(self.missiles.len() as u32);
        for m in &self.missiles {
            h.write_u32(m.id);
            for v in [m.x, m.y, m.z, m.vx, m.vy, m.prev_rel] {
                h.write_f32(v);
            }
            h.write_u32(m.warn as u32);
            h.write_u8(m.locked as u8);
        }
        h.write_u32(self.pending_missiles.len() as u32);
        for z in &self.pending_missiles {
            h.write_f32(*z);
        }
        h.write_u32(self.debris.len() as u32);
        for d in &self.debris {
            for v in [d.x, d.y, d.z, d.r] {
                h.write_f32(v);
            }
        }
        self.loadout.hash_into(h);
        self.rng.state_hash(h);
    }
}
