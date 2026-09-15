//! Rodadas dos três jogos: o resultado sai só da semente (engine/roteiro.rs).
//! Piloto-robô, itens e batidas mudam o filme, nunca distância, pontos ou duração.

use livex_sim::bots::{SKILL_MEDIAN, SKILL_P90, SKILL_RANDOM};
use livex_sim::engine::roteiro::{DURACAO_MAX_TICKS, DURACAO_MIN_TICKS, FATOR_MAX, FATOR_MIN};
use livex_sim::games::{
    jet_launcher, neon_drifter, void_walker, GAME_JET_LAUNCHER, GAME_NEON_DRIFTER, GAME_VOID_WALKER,
};
use livex_sim::run::{EndReason, Run};

const JOGOS: [(u32, f32); 3] = [
    (GAME_JET_LAUNCHER, jet_launcher::DISTANCIA_REFERENCIA),
    (GAME_NEON_DRIFTER, neon_drifter::DISTANCIA_REFERENCIA),
    (GAME_VOID_WALKER, void_walker::DISTANCIA_REFERENCIA),
];

const EF_BOOST: u8 = 1;
const EF_SHIELD: u8 = 2;
const EF_FUEL: u8 = 3;
const EF_GRIP: u8 = 4;
const EF_PULSE: u8 = 5;
const EF_TELEPORT: u8 = 6;
const AT_PASSIVE: u8 = 0;
const AT_ACTIVE: u8 = 1;
const AT_AUTO: u8 = 2;

fn slot(effect: u8, activation: u8, charges: u8, duration: u16, magnitude: f32) -> Vec<u8> {
    let mut b = vec![effect, activation, charges];
    b.extend_from_slice(&duration.to_le_bytes());
    for v in [magnitude, 0.0, 0.0, 0.0] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b
}

fn loadout(slots: &[Vec<u8>]) -> Vec<u8> {
    let mut b = vec![slots.len() as u8];
    for s in slots {
        b.extend_from_slice(s);
    }
    b
}

fn loadouts() -> [Vec<u8>; 3] {
    [
        Vec::new(),
        loadout(&[
            slot(EF_BOOST, AT_ACTIVE, 2, 180, 1.6),
            slot(EF_SHIELD, AT_AUTO, 1, 0, 1.0),
            slot(EF_FUEL, AT_PASSIVE, 1, 0, 1.4),
        ]),
        loadout(&[
            slot(EF_PULSE, AT_ACTIVE, 1, 0, 600.0),
            slot(EF_TELEPORT, AT_ACTIVE, 2, 0, 300.0),
            slot(EF_GRIP, AT_PASSIVE, 1, 0, 1.4),
        ]),
    ]
}

fn seed(i: u32) -> Vec<u8> {
    format!("rodada-{i}").into_bytes()
}

fn jogar(game: u32, seed: &[u8], lo: &[u8], skill: u32, bot: u64) -> (Run, Vec<u8>) {
    let mut run = Run::new_live(game, seed, lo).expect("partida válida");
    run.attach_skill_bot(skill, bot);
    while !run.step() {}
    let log = run.encode_log().to_vec();
    (run, log)
}

/// (ticks, distância, pontos, motivo do fim)
fn resumo(run: &mut Run) -> (u32, f64, f64, Option<EndReason>) {
    let r = *run.refresh_result();
    (run.tick(), r[2], r[3], run.ended())
}

#[test]
fn replay_reproduz_a_rodada_gerada() {
    for (game, _) in JOGOS {
        for i in 0..6 {
            for (k, lo) in loadouts().iter().enumerate() {
                let (mut live, log) = jogar(
                    game,
                    &seed(i),
                    lo,
                    SKILL_MEDIAN,
                    70 + (i * 3) as u64 + k as u64,
                );
                let mut rep = Run::new_replay(game, &seed(i), lo, &log).unwrap();
                while !rep.step() {}
                assert_eq!(rep.error(), 0, "jogo {game}, semente {i}, loadout {k}");
                assert_eq!(
                    rep.hash(),
                    live.hash(),
                    "jogo {game}, semente {i}, loadout {k}"
                );
                assert_eq!(rep.refresh_result(), live.refresh_result());
                assert_eq!(rep.telemetry, live.telemetry);
            }
        }
    }
}

#[test]
fn resultado_so_depende_da_semente() {
    for (game, _) in JOGOS {
        for i in 0..8 {
            let (mut base, _) = jogar(game, &seed(i), &[], SKILL_RANDOM, 1);
            let esperado = resumo(&mut base);
            for (k, lo) in loadouts().iter().enumerate() {
                for skill in [SKILL_RANDOM, SKILL_MEDIAN, SKILL_P90] {
                    let (mut run, _) = jogar(game, &seed(i), lo, skill, 500 + k as u64);
                    assert_eq!(
                        resumo(&mut run),
                        esperado,
                        "jogo {game}, semente {i}, loadout {k}, nível {skill}"
                    );
                }
            }
        }
    }
}

#[test]
fn duracao_distancia_e_pontos_ficam_dentro_do_roteiro() {
    for (game, referencia) in JOGOS {
        let mut distancias = Vec::new();
        for i in 0..301 {
            let (mut run, _) = jogar(game, &seed(10_000 + i), &[], SKILL_MEDIAN, i as u64);
            let (ticks, distancia, pontos, fim) = resumo(&mut run);
            assert!(
                (DURACAO_MIN_TICKS..=DURACAO_MAX_TICKS).contains(&ticks),
                "jogo {game}: {ticks} ticks"
            );
            assert_eq!(fim, Some(EndReason::GameOver));
            let fator = distancia as f32 / referencia;
            assert!(
                (FATOR_MIN - 0.001..=FATOR_MAX + 0.001).contains(&fator),
                "jogo {game}: fator {fator}"
            );
            assert!(
                (pontos - distancia * 2.0).abs() <= 1.0,
                "jogo {game}: {pontos} pontos para {distancia} m"
            );
            distancias.push(distancia);
        }
        distancias.sort_by(f64::total_cmp);
        let mediana = distancias[distancias.len() / 2];
        assert!(
            (mediana / referencia as f64 - 1.0).abs() < 0.05,
            "jogo {game}: mediana {mediana:.0} m contra referência {referencia} m"
        );
    }
}

#[test]
fn sementes_diferentes_geram_rodadas_diferentes() {
    for (game, _) in JOGOS {
        let (a, _) = jogar(game, &seed(1), &[], SKILL_RANDOM, 5);
        let (b, _) = jogar(game, &seed(1), &[], SKILL_RANDOM, 5);
        let (c, _) = jogar(game, &seed(2), &[], SKILL_RANDOM, 5);
        assert_eq!(a.hash(), b.hash());
        assert_ne!(a.hash(), c.hash());
    }
}
