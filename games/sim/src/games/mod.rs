//! Registro dos jogos. Despacho por enum em vez de trait object: sem alocação
//! dinâmica por tick e o compilador enxerga cada jogo inteiro para otimizar.

pub mod jet_launcher;
pub mod neon_drifter;
pub mod sandbox;
pub mod void_walker;

use crate::engine::hash::Fnv64;
use crate::engine::input::Input;
use crate::engine::loadout::Loadout;
use crate::engine::prng::Prng;

/// Códigos numéricos usados na fronteira com o JS. O backend repete esta tabela
/// em backend/src/services/sim/games.js e um teste confere as duas.
pub const GAME_SANDBOX: u32 = 0;
pub const GAME_JET_LAUNCHER: u32 = 1;
pub const GAME_NEON_DRIFTER: u32 = 2;
pub const GAME_VOID_WALKER: u32 = 3;

pub enum AnyGame {
    Sandbox(sandbox::Sandbox),
    JetLauncher(Box<jet_launcher::JetLauncher>),
    NeonDrifter(Box<neon_drifter::NeonDrifter>),
    VoidWalker(Box<void_walker::VoidWalker>),
}

impl AnyGame {
    pub fn new(code: u32, rng: Prng, loadout: Loadout) -> Option<AnyGame> {
        match code {
            GAME_SANDBOX => Some(AnyGame::Sandbox(sandbox::Sandbox::new(rng, loadout))),
            GAME_JET_LAUNCHER => Some(AnyGame::JetLauncher(Box::new(
                jet_launcher::JetLauncher::new(rng, loadout),
            ))),
            GAME_NEON_DRIFTER => Some(AnyGame::NeonDrifter(Box::new(
                neon_drifter::NeonDrifter::new(rng, loadout),
            ))),
            GAME_VOID_WALKER => Some(AnyGame::VoidWalker(Box::new(void_walker::VoidWalker::new(
                rng, loadout,
            )))),
            _ => None,
        }
    }

    pub fn max_ticks_for(code: u32) -> Option<u32> {
        match code {
            GAME_SANDBOX => Some(sandbox::MAX_TICKS),
            GAME_JET_LAUNCHER => Some(jet_launcher::MAX_TICKS),
            GAME_NEON_DRIFTER => Some(neon_drifter::MAX_TICKS),
            GAME_VOID_WALKER => Some(void_walker::MAX_TICKS),
            _ => None,
        }
    }

    pub fn step(&mut self, input: Input, prev: Input) -> bool {
        match self {
            AnyGame::Sandbox(g) => g.step(input, prev),
            AnyGame::JetLauncher(g) => g.step(input, prev),
            AnyGame::NeonDrifter(g) => g.step(input, prev),
            AnyGame::VoidWalker(g) => g.step(input, prev),
        }
    }

    pub fn distance(&self) -> f32 {
        match self {
            AnyGame::Sandbox(g) => g.distance(),
            AnyGame::JetLauncher(g) => g.distance(),
            AnyGame::NeonDrifter(g) => g.distance(),
            AnyGame::VoidWalker(g) => g.distance(),
        }
    }

    pub fn score(&self) -> f32 {
        match self {
            AnyGame::Sandbox(g) => g.score(),
            AnyGame::JetLauncher(g) => g.score(),
            AnyGame::NeonDrifter(g) => g.score(),
            AnyGame::VoidWalker(g) => g.score(),
        }
    }

    pub fn peak(&self) -> f32 {
        match self {
            AnyGame::Sandbox(g) => g.peak(),
            AnyGame::JetLauncher(g) => g.peak(),
            AnyGame::NeonDrifter(g) => g.peak(),
            AnyGame::VoidWalker(g) => g.peak(),
        }
    }

    pub fn loadout(&self) -> &Loadout {
        match self {
            AnyGame::Sandbox(g) => &g.loadout,
            AnyGame::JetLauncher(g) => &g.loadout,
            AnyGame::NeonDrifter(g) => &g.loadout,
            AnyGame::VoidWalker(g) => &g.loadout,
        }
    }

    /// Evento que entra na amostra de telemetria deste segundo.
    pub fn take_sample_event(&mut self) -> u32 {
        match self {
            AnyGame::Sandbox(g) => g.take_event(),
            AnyGame::JetLauncher(g) => g.take_sample_event(),
            AnyGame::NeonDrifter(g) => g.take_sample_event(),
            AnyGame::VoidWalker(g) => g.take_sample_event(),
        }
    }

    pub fn telemetry(&self, out: &mut Vec<f32>) {
        match self {
            AnyGame::Sandbox(g) => g.telemetry(out),
            AnyGame::JetLauncher(g) => g.telemetry(out),
            AnyGame::NeonDrifter(g) => g.telemetry(out),
            AnyGame::VoidWalker(g) => g.telemetry(out),
        }
    }

    /// Estado para o render. Pode consumir os eventos de quadro acumulados.
    pub fn render(&mut self, out: &mut Vec<f32>) {
        match self {
            AnyGame::Sandbox(g) => g.render(out),
            AnyGame::JetLauncher(g) => g.render(out),
            AnyGame::NeonDrifter(g) => g.render(out),
            AnyGame::VoidWalker(g) => g.render(out),
        }
    }

    pub fn hash_into(&self, h: &mut Fnv64) {
        match self {
            AnyGame::Sandbox(g) => g.hash_into(h),
            AnyGame::JetLauncher(g) => g.hash_into(h),
            AnyGame::NeonDrifter(g) => g.hash_into(h),
            AnyGame::VoidWalker(g) => g.hash_into(h),
        }
    }
}
