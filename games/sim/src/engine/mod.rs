pub mod hash;
pub mod input;
pub mod loadout;
pub mod prng;
pub mod roteiro;

/// Tick fixo da simulação. Nada de delta time: é isto que torna o replay possível.
pub const TICKS_PER_SECOND: u32 = 60;
pub const DT: f32 = 1.0 / TICKS_PER_SECOND as f32;

/// Aproxima `current` de `target` em no máximo `max_step`, sem passar.
pub fn approach(current: f32, target: f32, max_step: f32) -> f32 {
    if current < target {
        (current + max_step).min(target)
    } else {
        (current - max_step).max(target)
    }
}
