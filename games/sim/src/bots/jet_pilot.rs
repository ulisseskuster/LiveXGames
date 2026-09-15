//! Pilotos-robô do Jet Launcher.
//!
//! Servem para duas coisas: gerar partidas legítimas nos testes e calibrar a
//! economia. O "mediano" e o "p90" jogam com a mesma
//! estratégia e diferem no que separa jogadores reais: tempo de reação, precisão
//! de mira e acerto no momento da rolagem.
//!
//! O bot só olha o que um jogador vê na tela (posições, combustível, avisos) e
//! age pela mesma entrada que um jogador teria: botões e manche.

use std::collections::VecDeque;

use crate::engine::input::{Input, BTN_ACTION_A, BTN_ACTION_B, BTN_SWITCH_ITEM, BTN_USE_ITEM};
use crate::engine::loadout::{Activation, Effect};
use crate::engine::prng::Prng;
use crate::games::jet_launcher::{
    JetLauncher, CEILING_Y, HALF_WIDTH, MAX_LATERAL, MAX_VERTICAL, PLANE_RADIUS,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Skill {
    Median,
    P90,
    /// Sem atraso, sem erro, rolagem sempre na hora. Não existe jogador assim: é o
    /// teto do que o planejamento consegue, e separa "jogo difícil" de "bot ruim".
    Perfect,
}

pub struct JetPilot {
    rng: Prng,
    /// Atraso entre ver e agir, em ticks.
    delay: usize,
    queue: VecDeque<Input>,
    error_amp: f32,
    error_x: f32,
    error_y: f32,
    retarget: u32,
    /// Chance (0–100) de rolar no instante certo quando um míssil chega.
    roll_skill: u32,
    /// Quantos segundos de pista à frente o piloto planeja.
    visao: f32,
    roll_plan: Option<(u32, f32)>,
    last_rel: f32,
    last_desired: Input,
}

impl JetPilot {
    pub fn new(skill: Skill, seed: u64) -> JetPilot {
        let (delay, error_amp, roll_skill, visao) = match skill {
            Skill::Median => (15, 7.0, 40, 1.8),
            Skill::P90 => (6, 1.5, 95, 3.0),
            Skill::Perfect => (0, 0.0, 100, 3.0),
        };
        JetPilot {
            rng: Prng::from_u64(seed),
            delay,
            queue: VecDeque::with_capacity(32),
            error_amp,
            error_x: 0.0,
            error_y: 0.0,
            retarget: 0,
            roll_skill,
            visao,
            roll_plan: None,
            last_rel: f32::MAX,
            last_desired: Input::default(),
        }
    }

    pub fn next(&mut self, g: &JetLauncher) -> Input {
        let desired = self.desired(g);
        self.last_desired = desired;
        self.queue.push_back(desired);
        if self.queue.len() > self.delay {
            self.queue.pop_front().unwrap_or_default()
        } else {
            Input::default()
        }
    }

    /// Botão por borda de subida: só aperta se não estava apertado no tick anterior.
    fn tap(&self, buttons: &mut u16, btn: u16) {
        if self.last_desired.buttons & btn == 0 {
            *buttons |= btn;
        }
    }

    fn desired(&mut self, g: &JetLauncher) -> Input {
        if self.retarget == 0 {
            self.error_x = self.rng.range_f32(-1.0, 1.0) * self.error_amp;
            self.error_y = self.rng.range_f32(-1.0, 1.0) * self.error_amp;
            self.retarget = 20 + self.rng.below(30);
        } else {
            self.retarget -= 1;
        }

        let (mut tx, mut ty) = (g.x, 50.0f32);
        if let Some(r) = g
            .rings
            .iter()
            .filter(|r| !r.passed && r.z > g.z + 8.0 && r.z < g.z + 380.0)
            .min_by(|a, b| a.z.total_cmp(&b.z))
        {
            tx = r.x;
            ty = r.y;
        }

        // Previsão, como um jogador olhando a pista: para cada prédio à frente, onde
        // o jato estará ao chegar nele seguindo para o alvo atual, respeitando o
        // quanto ele consegue andar de lado e subir nesse tempo. Conferir só o ponto
        // de destino (versão anterior) deixava o jato atravessar o prédio que ficava
        // no meio da diagonal — até o piloto perfeito batia duas vezes por partida.
        let horizon = g.z + g.speed * self.visao + 80.0;
        let teto_util = CEILING_Y - 6.0;
        let mut obstaculo_perto = false;
        let mut a_frente: Vec<_> = g
            .buildings
            .iter()
            .filter(|b| b.z + b.hd > g.z - 2.0 && b.z - b.hd < horizon)
            .collect();
        a_frente.sort_by(|a, b| (a.z - a.hd).total_cmp(&(b.z - b.hd)));
        let chegar =
            |de: f32, para: f32, vmax: f32, t: f32| de + (para - de).clamp(-vmax * t, vmax * t);
        let mut correcoes = 0;
        for b in a_frente {
            if correcoes >= 3 {
                break;
            }
            let t = ((b.z - b.hd) - g.z).max(0.0) / g.speed.max(1.0);
            let folga = b.hw + PLANE_RADIUS + 2.5;
            let px = chegar(g.x, tx, MAX_LATERAL, t);
            let py = chegar(g.y, ty, MAX_VERTICAL, t);
            if (px - b.x).abs() >= folga || py >= b.h + PLANE_RADIUS + 2.5 {
                continue;
            }
            obstaculo_perto = true;
            correcoes += 1;

            let subir = b.h + 9.0;
            let da_para_subir =
                subir <= teto_util && (subir - g.y).max(0.0) <= MAX_VERTICAL * (t + 0.15);
            let lado = [b.x - folga - 2.0, b.x + folga + 2.0]
                .into_iter()
                .filter(|x| {
                    x.abs() <= HALF_WIDTH - 2.0 && (x - g.x).abs() <= MAX_LATERAL * (t + 0.15)
                })
                .min_by(|a, c| (a - tx).abs().total_cmp(&(c - tx).abs()));
            match (da_para_subir, lado) {
                (true, Some(x)) if (x - tx).abs() < (subir - ty).max(0.0) => tx = x,
                (true, _) => ty = ty.max(subir),
                (false, Some(x)) => tx = x,
                // Nenhuma saída dá tempo: sobe o máximo e vai para o lado mais aberto.
                (false, None) => {
                    ty = teto_util;
                    tx = if b.x > g.x {
                        b.x - folga - 2.0
                    } else {
                        b.x + folga + 2.0
                    };
                }
            }
        }
        let mut drones_a_frente = 0;
        for d in g
            .drones
            .iter()
            .filter(|d| d.alive && d.z > g.z && d.z < g.z + 500.0)
        {
            drones_a_frente += 1;
            if d.z < g.z + 150.0 {
                let dx = d.x_at(g.world_time);
                if (dx - tx).abs() < 9.0 && (d.y - ty).abs() < 9.0 {
                    obstaculo_perto = true;
                    ty = if d.y > 50.0 { d.y - 14.0 } else { d.y + 14.0 };
                }
            }
        }
        for d in g.debris.iter().filter(|d| d.z > g.z && d.z < g.z + 150.0) {
            if (d.x - tx).abs() < d.r + 6.0 && (d.y - ty).abs() < d.r + 6.0 {
                obstaculo_perto = true;
                ty = if d.y > 50.0 {
                    d.y - d.r - 9.0
                } else {
                    d.y + d.r + 9.0
                };
            }
        }

        tx += self.error_x;
        ty += self.error_y;
        let ax = ((tx - g.x) * 0.09 - g.vx * 0.03).clamp(-1.0, 1.0);
        let ay = ((ty - g.y) * 0.09 - g.vy * 0.03).clamp(-1.0, 1.0);

        let mut buttons = 0u16;
        if g.fuel > 0.35 * g.fuel_max && !obstaculo_perto {
            buttons |= BTN_ACTION_B;
        }

        let missil = g
            .missiles
            .iter()
            .filter(|m| m.alive && m.warn == 0 && m.z > g.z)
            .min_by(|a, b| a.z.total_cmp(&b.z));
        let missil_travado = g.missiles.iter().any(|m| m.alive && m.locked);
        if let Some(m) = missil {
            let rel = m.z - g.z;
            let fechamento = g.speed + 170.0;
            let plano = match self.roll_plan {
                Some((id, gatilho)) if id == m.id => gatilho,
                _ => {
                    // Centro da rolagem no instante do cruzamento: metade dos 18 ticks.
                    let ideal = fechamento * 0.15;
                    let gatilho = if self.rng.below(100) < self.roll_skill {
                        ideal
                    } else {
                        self.rng.range_f32(0.0, fechamento * 0.6)
                    };
                    self.roll_plan = Some((m.id, gatilho));
                    gatilho
                }
            };
            if self.last_rel > plano && rel <= plano && g.roll_cooldown == 0 {
                self.tap(&mut buttons, BTN_ACTION_A);
            }
            self.last_rel = rel;
        } else {
            self.last_rel = f32::MAX;
        }

        let desejado = if missil_travado {
            Some(Effect::Countermeasure)
        } else if drones_a_frente >= 3 {
            Some(Effect::Pulse)
        } else if g.fuel > 0.5 * g.fuel_max && !obstaculo_perto {
            Some(Effect::Boost)
        } else {
            None
        };
        if let Some(efeito) = desejado {
            let tem =
                g.loadout.slots.iter().any(|s| {
                    s.effect == efeito && s.activation == Activation::Active && s.charges > 0
                });
            if tem {
                let selecionado = g.loadout.slots.get(g.loadout.selected_index());
                if selecionado.is_some_and(|s| s.effect == efeito) {
                    self.tap(&mut buttons, BTN_USE_ITEM);
                } else {
                    self.tap(&mut buttons, BTN_SWITCH_ITEM);
                }
            }
        }

        Input::from_raw(
            buttons as u32,
            libm::roundf(ax * 127.0) as i32,
            libm::roundf(ay * 127.0) as i32,
        )
    }
}
