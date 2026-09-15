//! Itens equipados na partida, no formato binário que o servidor monta a partir
//! do `flight_bonus` do catálogo (ver backend/src/services/sim/loadoutCodec.js).
//!
//! O servidor só serializa números; quem decide o que eles significam é o jogo,
//! aqui. Balancear um item continua sendo editar dado no catálogo.
//!
//! Cada slot ocupa 21 bytes fixos:
//!   [u8 efeito][u8 ativação][u8 cargas][u16 LE duração em ticks]
//!   [f32 LE magnitude][f32 LE agilidade][f32 LE vel. máxima][f32 LE puxão gravitacional]

pub const MAX_SLOTS: usize = 3;
pub const SLOT_BYTES: usize = 21;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Effect {
    None,
    Boost,
    Shield,
    FuelCapacity,
    Grip,
    Pulse,
    Teleport,
    Countermeasure,
    Anchor,
    Revive,
}

impl Effect {
    fn from_u8(v: u8) -> Option<Effect> {
        Some(match v {
            0 => Effect::None,
            1 => Effect::Boost,
            2 => Effect::Shield,
            3 => Effect::FuelCapacity,
            4 => Effect::Grip,
            5 => Effect::Pulse,
            6 => Effect::Teleport,
            7 => Effect::Countermeasure,
            8 => Effect::Anchor,
            9 => Effect::Revive,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Activation {
    /// Vale a partida inteira (tanque maior, pneus).
    Passive,
    /// O jogador decide quando usar (tecla de item).
    Active,
    /// Dispara sozinho quando o gatilho acontece (escudo, revive).
    Auto,
}

#[derive(Clone, Copy, Debug)]
pub struct ItemSlot {
    pub effect: Effect,
    pub activation: Activation,
    pub charges: u8,
    pub duration_ticks: u16,
    pub magnitude: f32,
    pub agility: f32,
    pub top_speed: f32,
    pub gravity_pull: f32,
    /// É isto que decide se o item sai do inventário no fim da partida.
    pub used: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct LoadoutError;

pub struct Loadout {
    pub slots: Vec<ItemSlot>,
    selected: usize,
}

impl Loadout {
    pub fn empty() -> Loadout {
        Loadout {
            slots: Vec::new(),
            selected: 0,
        }
    }

    pub fn parse(bytes: &[u8]) -> Result<Loadout, LoadoutError> {
        if bytes.is_empty() {
            return Ok(Loadout::empty());
        }
        let count = bytes[0] as usize;
        if count > MAX_SLOTS || bytes.len() != 1 + count * SLOT_BYTES {
            return Err(LoadoutError);
        }
        let mut slots = Vec::with_capacity(count);
        for i in 0..count {
            let b = &bytes[1 + i * SLOT_BYTES..1 + (i + 1) * SLOT_BYTES];
            let effect = Effect::from_u8(b[0]).ok_or(LoadoutError)?;
            let activation = match b[1] {
                0 => Activation::Passive,
                1 => Activation::Active,
                2 => Activation::Auto,
                _ => return Err(LoadoutError),
            };
            let charges = b[2];
            let duration_ticks = u16::from_le_bytes([b[3], b[4]]);
            let f = |o: usize| f32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
            let (magnitude, agility, top_speed, gravity_pull) = (f(5), f(9), f(13), f(17));

            // Faixas largas, só para barrar NaN/infinito e valores absurdos que
            // fariam a física explodir. O balanceamento fino é do catálogo.
            let sane = magnitude.is_finite()
                && (0.0..=10_000.0).contains(&magnitude)
                && [agility, top_speed, gravity_pull]
                    .iter()
                    .all(|t| t.is_finite() && (-1.0..=1.0).contains(t));
            if !sane || charges > 10 || duration_ticks > 3600 {
                return Err(LoadoutError);
            }
            slots.push(ItemSlot {
                effect,
                activation,
                charges,
                duration_ticks,
                magnitude,
                agility,
                top_speed,
                gravity_pull,
                used: false,
            });
        }
        let selected = slots
            .iter()
            .position(|s| s.activation == Activation::Active)
            .unwrap_or(0);
        Ok(Loadout { slots, selected })
    }

    /// Slot ativo selecionado, se ainda tiver carga.
    pub fn selected_active(&self) -> Option<usize> {
        let slot = self.slots.get(self.selected)?;
        (slot.activation == Activation::Active && slot.charges > 0).then_some(self.selected)
    }

    pub fn selected_index(&self) -> usize {
        self.selected
    }

    /// Passa para o próximo item ativo, em ordem circular.
    pub fn cycle_active(&mut self) {
        let n = self.slots.len();
        for step in 1..=n {
            let i = (self.selected + step) % n;
            if self.slots[i].activation == Activation::Active {
                self.selected = i;
                return;
            }
        }
    }

    pub fn auto_slot(&self, effect: Effect) -> Option<usize> {
        self.slots
            .iter()
            .position(|s| s.activation == Activation::Auto && s.effect == effect && s.charges > 0)
    }

    pub fn consume(&mut self, idx: usize) {
        let slot = &mut self.slots[idx];
        slot.charges = slot.charges.saturating_sub(1);
        slot.used = true;
    }

    /// Produto das magnitudes dos passivos com o efeito (1.0 se nenhum). Marca
    /// como usado só o que o jogo de fato consultou: passivo de efeito que o jogo
    /// não implementa volta para o inventário em vez de ser gasto à toa.
    pub fn passive_multiplier(&mut self, effect: Effect) -> f32 {
        let mut m = 1.0f32;
        for slot in self.slots.iter_mut() {
            if slot.activation == Activation::Passive && slot.effect == effect {
                m *= slot.magnitude;
                slot.used = true;
            }
        }
        m
    }

    /// Soma dos custos dos passivos em uso. Todo passivo forte cobra algo.
    pub fn used_passive_tradeoffs(&self) -> (f32, f32, f32) {
        self.slots
            .iter()
            .filter(|s| s.activation == Activation::Passive && s.used)
            .fold((0.0, 0.0, 0.0), |(a, t, g), s| {
                (a + s.agility, t + s.top_speed, g + s.gravity_pull)
            })
    }

    pub fn used_mask(&self) -> u32 {
        self.slots
            .iter()
            .enumerate()
            .filter(|(_, s)| s.used)
            .fold(0, |m, (i, _)| m | (1 << i))
    }

    pub fn hash_into(&self, h: &mut super::hash::Fnv64) {
        h.write_u32(self.selected as u32);
        for s in &self.slots {
            h.write_u8(s.charges);
            h.write_u8(s.used as u8);
        }
    }
}
