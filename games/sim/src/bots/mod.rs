//! Jogadores-robô. Servem a testes (gerar partidas sem navegador) e aos filmes
//! das rodadas: o piloto só decide o que aparece na tela. O resultado da rodada
//! vem do roteiro sorteado da semente (engine/roteiro.rs), não do piloto.

pub mod jet_pilot;

use crate::engine::input::{Input, BTN_ACTION_A, BTN_ACTION_B, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::prng::Prng;
use crate::games::AnyGame;

/// Níveis aceitos por `run_attach_skill_bot`. Jogo sem piloto próprio cai no aleatório.
pub const SKILL_RANDOM: u32 = 0;
pub const SKILL_MEDIAN: u32 = 1;
pub const SKILL_P90: u32 = 2;
/// Sem atraso nem erro (ver jet_pilot::Skill::Perfect).
pub const SKILL_PERFECT: u32 = 3;

pub enum Bot {
    Random(RandomBot),
    JetPilot(jet_pilot::JetPilot),
    Cinema(CinemaPilot),
}

impl Bot {
    pub fn for_game(game: &AnyGame, skill: u32, seed: u64) -> Bot {
        let nivel = match skill {
            SKILL_MEDIAN => Some(jet_pilot::Skill::Median),
            SKILL_P90 => Some(jet_pilot::Skill::P90),
            SKILL_PERFECT => Some(jet_pilot::Skill::Perfect),
            _ => None,
        };
        match (game, nivel) {
            (AnyGame::JetLauncher(_), Some(n)) => Bot::JetPilot(jet_pilot::JetPilot::new(n, seed)),
            (AnyGame::NeonDrifter(_), Some(_)) | (AnyGame::VoidWalker(_), Some(_)) => {
                Bot::Cinema(CinemaPilot::new(seed))
            }
            _ => Bot::Random(RandomBot::new(seed)),
        }
    }

    pub fn next(&mut self, game: &AnyGame) -> Input {
        match (self, game) {
            (Bot::JetPilot(p), AnyGame::JetLauncher(g)) => p.next(g),
            (Bot::Random(b), _) => b.next(),
            (Bot::Cinema(p), g) => p.next(g),
            _ => Input::default(),
        }
    }
}

/// Piloto dos filmes do Neon e do Void: trajetória contínua e manobras visíveis.
/// Lê o estado do jogo direto, nunca o buffer de render.
pub struct CinemaPilot {
    tick: u32,
    fase: f32,
}

impl CinemaPilot {
    fn new(seed: u64) -> Self {
        Self {
            tick: 0,
            fase: (seed % 628) as f32 / 100.0,
        }
    }

    fn next(&mut self, game: &AnyGame) -> Input {
        let t = self.tick as f32 / 60.0;
        let (ax, ay, neon) = match game {
            AnyGame::NeonDrifter(g) => {
                let mut alvo_x = libm::sinf(t * 0.38 + self.fase) * 7.5;
                // Troca de faixa quando um carro ocupa a faixa do alvo logo à frente.
                if let Some(c) = g.trafego.iter().find(|c| {
                    let d = c.z - g.z;
                    d > 0.0 && d < 65.0 && (c.x - alvo_x).abs() < 3.5
                }) {
                    alvo_x = if c.x > 0.0 { -7.0 } else { 7.0 };
                }
                (((alvo_x - g.x) * 28.0).clamp(-127.0, 127.0) as i32, 0, true)
            }
            AnyGame::VoidWalker(g) => {
                let alvo_x = libm::sinf(t * 0.38 + self.fase) * 24.0;
                let alvo_y = 45.0 + libm::sinf(t * 0.24 + self.fase) * 22.0;
                (
                    ((alvo_x - g.x) * 9.0).clamp(-127.0, 127.0) as i32,
                    ((alvo_y - g.y) * 10.0).clamp(-127.0, 127.0) as i32,
                    false,
                )
            }
            _ => return Input::default(),
        };
        let mut buttons = 0;
        if self.tick % 540 < 280 {
            buttons |= BTN_ACTION_A;
        }
        if neon && self.tick % 720 > 420 {
            buttons |= BTN_ACTION_B;
        }
        if self.tick % 240 == 120 {
            buttons |= BTN_USE_ITEM;
        }
        if self.tick % 720 == 0 {
            buttons |= BTN_SWITCH_ITEM;
        }
        self.tick += 1;
        Input::from_raw(buttons as u32, ax, ay)
    }
}

/// Mexe o eixo ao acaso a cada 10–40 ticks e às vezes aperta "usar item".
/// Tem PRNG próprio: a sorte do bot não pode consumir a sorte da partida, senão
/// a mesma semente geraria pistas diferentes com e sem bot.
pub struct RandomBot {
    rng: Prng,
    hold: u32,
    current: Input,
}

impl RandomBot {
    pub fn new(seed: u64) -> RandomBot {
        RandomBot {
            rng: Prng::from_u64(seed),
            hold: 0,
            current: Input::default(),
        }
    }

    pub fn next(&mut self) -> Input {
        if self.hold == 0 {
            self.hold = 10 + self.rng.below(31);
            let ax = self.rng.below(255) as i32 - 127;
            let use_item = self.rng.below(100) < 6;
            self.current = Input::from_raw(if use_item { BTN_USE_ITEM as u32 } else { 0 }, ax, 0);
        } else {
            self.hold -= 1;
            // Solta o botão no tick seguinte: "usar item" é por borda de subida.
            self.current.buttons = 0;
        }
        self.current
    }
}
