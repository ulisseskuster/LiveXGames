//! Uma partida: jogo + tick + entrada + log (ao vivo) ou registros (replay).
//!
//! O mesmo `step` serve aos dois modos. É essa a garantia central do projeto:
//! não existe "caminho do servidor" diferente do "caminho do cliente".

use crate::bots::Bot;
use crate::engine::hash::Fnv64;
use crate::engine::input::{decode_log, Input, InputRecord, LogError, LogRecorder};
use crate::engine::loadout::Loadout;
use crate::engine::prng::Prng;
use crate::engine::TICKS_PER_SECOND;
use crate::games::AnyGame;

pub const ERR_BAD_HANDLE: i32 = -1;
pub const ERR_UNKNOWN_GAME: i32 = -2;
pub const ERR_BAD_LOADOUT: i32 = -3;
pub const ERR_BAD_LOG: i32 = -4;
pub const ERR_LOG_EXCEEDS_MAX: i32 = -5;
/// O log diz que a partida durou mais do que a simulação permite: o jogo acabou
/// antes do tick final declarado. Só acontece com log adulterado ou versão de
/// simulação diferente.
pub const ERR_END_MISMATCH: i32 = -6;
pub const ERR_BAD_SEED: i32 = -7;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EndReason {
    GameOver = 1,
    Quit = 2,
    MaxTicks = 3,
}

enum Mode {
    Live {
        recorder: LogRecorder,
        bot: Option<Bot>,
    },
    Replay {
        records: Vec<InputRecord>,
        next: usize,
        end_tick: u32,
    },
}

/// Campos da telemetria amostrada a cada segundo:
/// [t, fase, distância, altitude, velocidade, combustível %, escudo, multiplicador, evento]
pub const TELEMETRY_FIELDS: usize = 9;

pub struct Run {
    game: AnyGame,
    game_code: u32,
    max_ticks: u32,
    tick: u32,
    input: Input,
    prev_input: Input,
    mode: Mode,
    ended: Option<EndReason>,
    error: i32,
    hash: Fnv64,
    pub telemetry: Vec<f32>,
    pub render: Vec<f32>,
    pub result: [f64; 10],
    pub log_out: Vec<u8>,
}

impl Run {
    fn build(game_code: u32, seed: &[u8], loadout: &[u8], mode: Mode) -> Result<Run, i32> {
        if seed.is_empty() || seed.len() > 64 {
            return Err(ERR_BAD_SEED);
        }
        let max_ticks = AnyGame::max_ticks_for(game_code).ok_or(ERR_UNKNOWN_GAME)?;
        let loadout = Loadout::parse(loadout).map_err(|_| ERR_BAD_LOADOUT)?;
        let game = AnyGame::new(game_code, Prng::from_seed_bytes(seed), loadout)
            .ok_or(ERR_UNKNOWN_GAME)?;
        let mut hash = Fnv64::new();
        hash.write_u32(game_code);
        hash.write_bytes(seed);
        Ok(Run {
            game,
            game_code,
            max_ticks,
            tick: 0,
            input: Input::default(),
            prev_input: Input::default(),
            mode,
            ended: None,
            error: 0,
            hash,
            telemetry: Vec::new(),
            render: Vec::new(),
            result: [0.0; 10],
            log_out: Vec::new(),
        })
    }

    pub fn new_live(game_code: u32, seed: &[u8], loadout: &[u8]) -> Result<Run, i32> {
        Run::build(
            game_code,
            seed,
            loadout,
            Mode::Live {
                recorder: LogRecorder::new(),
                bot: None,
            },
        )
    }

    pub fn new_replay(game_code: u32, seed: &[u8], loadout: &[u8], log: &[u8]) -> Result<Run, i32> {
        let max_ticks = AnyGame::max_ticks_for(game_code).ok_or(ERR_UNKNOWN_GAME)?;
        let decoded = decode_log(log, max_ticks).map_err(|e| match e {
            LogError::ExceedsMaxTicks => ERR_LOG_EXCEEDS_MAX,
            _ => ERR_BAD_LOG,
        })?;
        Run::build(
            game_code,
            seed,
            loadout,
            Mode::Replay {
                records: decoded.records,
                next: 0,
                end_tick: decoded.end_tick,
            },
        )
    }

    pub fn attach_bot(&mut self, seed: u64) {
        self.attach_skill_bot(crate::bots::SKILL_RANDOM, seed);
    }

    /// Piloto-robô com nível (ver bots::SKILL_*). Jogo sem piloto próprio usa o aleatório.
    pub fn attach_skill_bot(&mut self, skill: u32, seed: u64) {
        let novo = Bot::for_game(&self.game, skill, seed);
        if let Mode::Live { bot, .. } = &mut self.mode {
            *bot = Some(novo);
        }
    }

    pub fn set_input(&mut self, input: Input) {
        self.input = input;
    }

    pub fn tick(&self) -> u32 {
        self.tick
    }

    /// Leitura do estado do jogo, para testes e relatórios de balanceamento.
    pub fn game(&self) -> &AnyGame {
        &self.game
    }

    pub fn ended(&self) -> Option<EndReason> {
        self.ended
    }

    pub fn error(&self) -> i32 {
        self.error
    }

    /// Avança um tick. Devolve true se a partida terminou (ou já estava terminada).
    pub fn step(&mut self) -> bool {
        if self.ended.is_some() {
            return true;
        }

        match &mut self.mode {
            Mode::Live { recorder, bot } => {
                if let Some(bot) = bot {
                    self.input = bot.next(&self.game);
                }
                recorder.observe(self.tick, self.input);
            }
            Mode::Replay {
                records,
                next,
                end_tick,
            } => {
                if self.tick >= *end_tick {
                    // O jogador saiu antes do fim natural: vale o que andou até aqui.
                    self.finish(EndReason::Quit);
                    return true;
                }
                if let Some(r) = records.get(*next) {
                    if r.tick == self.tick {
                        self.input = r.input;
                        *next += 1;
                    }
                }
            }
        }

        let over = self.game.step(self.input, self.prev_input);
        self.prev_input = self.input;
        self.tick += 1;

        if over {
            if let Mode::Replay { end_tick, .. } = self.mode {
                if self.tick != end_tick {
                    self.error = ERR_END_MISMATCH;
                }
            }
            self.finish(EndReason::GameOver);
            return true;
        }
        if self.tick % TICKS_PER_SECOND == 0 {
            self.game.hash_into(&mut self.hash);
            self.sample_telemetry();
        }
        if self.tick >= self.max_ticks {
            self.finish(EndReason::MaxTicks);
            return true;
        }
        false
    }

    /// Encerramento pedido pelo jogador na partida ao vivo.
    pub fn quit(&mut self) {
        // No modo replay isto só encerra a reprodução local: o resultado
        // autoritativo já foi gerado e persistido pelo servidor na abertura.
        if self.ended.is_none() {
            self.finish(EndReason::Quit);
        }
    }

    fn finish(&mut self, reason: EndReason) {
        self.ended = Some(reason);
        self.game.hash_into(&mut self.hash);
        self.hash.write_u32(self.tick);
        self.hash.write_u8(reason as u8);
        self.sample_telemetry();
    }

    /// O jogo guarda o evento do segundo (o mais importante, não o último); a
    /// partida só o recolhe na hora de amostrar.
    fn sample_telemetry(&mut self) {
        let event = self.game.take_sample_event();
        self.telemetry
            .push(self.tick as f32 / TICKS_PER_SECOND as f32);
        self.game.telemetry(&mut self.telemetry);
        self.telemetry.push(event as f32);
    }

    /// [estado, tick, distância, score, pico, máscara de itens usados,
    ///  hash alto, hash baixo, motivo do fim, código do jogo]
    ///
    /// Distância e score saem arredondados para inteiro aqui, uma vez só: o
    /// servidor calcula moeda a partir deste número e nunca de um float cru.
    pub fn refresh_result(&mut self) -> &[f64; 10] {
        let hash = self.hash.finish();
        self.result = [
            if self.ended.is_some() { 1.0 } else { 0.0 },
            self.tick as f64,
            libm::roundf(self.game.distance()) as f64,
            libm::roundf(self.game.score()) as f64,
            libm::roundf(self.game.peak()) as f64,
            self.game.loadout().used_mask() as f64,
            (hash >> 32) as f64,
            (hash & 0xFFFF_FFFF) as f64,
            self.ended.map_or(0.0, |r| r as u8 as f64),
            self.game_code as f64,
        ];
        &self.result
    }

    pub fn refresh_render(&mut self) -> &[f32] {
        self.game.render(&mut self.render);
        &self.render
    }

    pub fn encode_log(&mut self) -> &[u8] {
        self.log_out = match &self.mode {
            Mode::Live { recorder, .. } => recorder.encode(self.tick),
            Mode::Replay { .. } => Vec::new(),
        };
        &self.log_out
    }

    pub fn hash(&self) -> u64 {
        self.hash.finish()
    }
}
