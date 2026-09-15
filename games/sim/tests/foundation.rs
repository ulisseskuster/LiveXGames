//! Garantias da fundação: determinismo, replay idêntico ao vivo, log adulterado
//! recusado e itens marcados como usados só quando de fato agiram.

use livex_sim::engine::input::{decode_log, Input, LogError, LogRecorder, BTN_MASK};
use livex_sim::engine::loadout::Loadout;
use livex_sim::games::{sandbox, AnyGame, GAME_SANDBOX};
use livex_sim::run::{EndReason, Run, ERR_BAD_LOG, ERR_END_MISMATCH, ERR_LOG_EXCEEDS_MAX};

const EF_BOOST: u8 = 1;
const EF_SHIELD: u8 = 2;
const EF_FUEL: u8 = 3;
const EF_GRIP: u8 = 4;
const AT_PASSIVE: u8 = 0;
const AT_ACTIVE: u8 = 1;
const AT_AUTO: u8 = 2;

fn slot(
    effect: u8,
    activation: u8,
    charges: u8,
    duration: u16,
    magnitude: f32,
    agility: f32,
) -> Vec<u8> {
    let mut b = vec![effect, activation, charges];
    b.extend_from_slice(&duration.to_le_bytes());
    for v in [magnitude, agility, 0.0, 0.0] {
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

fn seed(i: u32) -> Vec<u8> {
    format!("semente-{i}").into_bytes()
}

fn play_bot(seed: &[u8], loadout: &[u8], bot: u64) -> (Run, Vec<u8>) {
    let mut run = Run::new_live(GAME_SANDBOX, seed, loadout).expect("partida válida");
    run.attach_bot(bot);
    while !run.step() {}
    let log = run.encode_log().to_vec();
    (run, log)
}

fn replay(seed: &[u8], loadout: &[u8], log: &[u8]) -> Run {
    let mut run = Run::new_replay(GAME_SANDBOX, seed, loadout, log).expect("log válido");
    while !run.step() {}
    run
}

#[test]
fn mesma_semente_e_mesmas_entradas_dao_o_mesmo_hash() {
    for i in 0..20 {
        let (a, _) = play_bot(&seed(i), &[], 7);
        let (b, _) = play_bot(&seed(i), &[], 7);
        assert_eq!(a.hash(), b.hash(), "semente {i}");
    }
}

#[test]
fn sementes_diferentes_geram_partidas_diferentes() {
    let (a, _) = play_bot(&seed(1), &[], 7);
    let (b, _) = play_bot(&seed(2), &[], 7);
    assert_ne!(a.hash(), b.hash());
}

#[test]
fn replay_reproduz_exatamente_a_partida_ao_vivo() {
    let lo = loadout(&[
        slot(EF_BOOST, AT_ACTIVE, 2, 120, 1.5, 0.0),
        slot(EF_SHIELD, AT_AUTO, 1, 0, 1.0, 0.0),
    ]);
    for i in 0..30 {
        let (mut live, log) = play_bot(&seed(i), &lo, 1000 + i as u64);
        let mut rep = replay(&seed(i), &lo, &log);
        assert_eq!(rep.error(), 0, "semente {i}");
        assert_eq!(rep.hash(), live.hash(), "semente {i}");
        assert_eq!(rep.refresh_result(), live.refresh_result(), "semente {i}");
        assert_eq!(rep.telemetry, live.telemetry, "semente {i}");
    }
}

#[test]
fn sair_no_meio_vale_so_o_que_andou() {
    let mut live = Run::new_live(GAME_SANDBOX, &seed(3), &[]).unwrap();
    live.attach_bot(42);
    for _ in 0..300 {
        live.step();
    }
    live.quit();
    assert_eq!(live.ended(), Some(EndReason::Quit));
    let log = live.encode_log().to_vec();

    let rep = replay(&seed(3), &[], &log);
    assert_eq!(rep.ended(), Some(EndReason::Quit));
    assert_eq!(rep.tick(), 300);
    assert_eq!(rep.hash(), live.hash());
}

#[test]
fn log_que_declara_fim_depois_do_game_over_e_recusado() {
    let (live, log) = play_bot(&seed(5), &[], 9);
    assert_eq!(
        live.ended(),
        Some(EndReason::GameOver),
        "o bot aleatório precisa bater até o fim"
    );

    // Reescreve o mesmo log dizendo que a partida durou 5 ticks a mais.
    let decoded = decode_log(&log, sandbox::MAX_TICKS).unwrap();
    let mut recorder = LogRecorder::new();
    for r in &decoded.records {
        recorder.observe(r.tick, r.input);
    }
    let forjado = recorder.encode(decoded.end_tick + 5);

    let mut rep = Run::new_replay(GAME_SANDBOX, &seed(5), &[], &forjado).unwrap();
    while !rep.step() {}
    assert_eq!(rep.error(), ERR_END_MISMATCH);
}

#[test]
fn log_fora_da_forma_canonica_e_recusado() {
    let max = sandbox::MAX_TICKS;
    let mut recorder = LogRecorder::new();
    recorder.observe(10, Input::from_raw(0, 50, 0));
    let valido = recorder.encode(100);
    assert!(decode_log(&valido, max).is_ok());

    let mut versao = valido.clone();
    versao[0] = 9;
    assert_eq!(decode_log(&versao, max).err(), Some(LogError::BadVersion));

    let mut sobra = valido.clone();
    sobra.push(0);
    assert_eq!(decode_log(&sobra, max).err(), Some(LogError::TrailingBytes));

    assert_eq!(
        decode_log(&valido[..valido.len() - 2], max).err(),
        Some(LogError::Truncated)
    );

    // Eixo -128 nunca sai do gravador (o JS é limitado a -127..127).
    let mut eixo = valido.clone();
    eixo[5] = 0x80;
    assert_eq!(decode_log(&eixo, max).err(), Some(LogError::InvalidInput));

    // Bit de botão desconhecido.
    let mut botao = valido.clone();
    botao[3] = ((BTN_MASK + 1) & 0xFF) as u8;
    botao[4] = ((BTN_MASK + 1) >> 8) as u8;
    assert_eq!(decode_log(&botao, max).err(), Some(LogError::InvalidInput));

    let mut depois = LogRecorder::new();
    depois.observe(100, Input::from_raw(0, 50, 0));
    assert_eq!(
        decode_log(&depois.encode(100), max).err(),
        Some(LogError::RecordAfterEnd)
    );

    // Registro repetindo a entrada anterior: o gravador nunca produz.
    let redundante = [1u8, 1, 0, 0, 0, 0, 0, 5];
    assert_eq!(
        decode_log(&redundante, max).err(),
        Some(LogError::RedundantRecord)
    );
}

#[test]
fn log_alem_do_limite_do_jogo_e_recusado() {
    let log = LogRecorder::new().encode(sandbox::MAX_TICKS + 1);
    assert_eq!(
        Run::new_replay(GAME_SANDBOX, &seed(1), &[], &log).err(),
        Some(ERR_LOG_EXCEEDS_MAX)
    );
    assert_eq!(
        Run::new_replay(GAME_SANDBOX, &seed(1), &[], &[1, 0]).err(),
        Some(ERR_BAD_LOG)
    );
}

#[test]
fn registros_espacados_usam_varint_de_varios_bytes() {
    let mut recorder = LogRecorder::new();
    recorder.observe(0, Input::from_raw(1, -127, 127));
    recorder.observe(3000, Input::from_raw(0, 0, 0));
    let decoded = decode_log(&recorder.encode(3500), sandbox::MAX_TICKS).unwrap();
    assert_eq!(decoded.records.len(), 2);
    assert_eq!(decoded.records[1].tick, 3000);
    assert_eq!(decoded.records[0].input, Input::from_raw(1, -127, 127));
    assert_eq!(decoded.end_tick, 3500);
}

#[test]
fn escudo_so_sai_do_inventario_se_absorver_uma_batida() {
    // Parado no centro da pista, o bloco bate cedo ou tarde.
    let lo = loadout(&[slot(EF_SHIELD, AT_AUTO, 1, 0, 1.0, 0.0)]);
    let mut run = Run::new_live(GAME_SANDBOX, &seed(11), &lo).unwrap();
    while !run.step() {}
    assert_eq!(run.refresh_result()[5] as u32 & 1, 1);

    // Efeito que o sandbox não implementa volta intacto.
    let grip = loadout(&[slot(EF_GRIP, AT_PASSIVE, 1, 0, 1.4, 0.0)]);
    let mut run = Run::new_live(GAME_SANDBOX, &seed(11), &grip).unwrap();
    while !run.step() {}
    assert_eq!(run.refresh_result()[5] as u32, 0);
}

#[test]
fn passivo_de_tanque_e_usado_desde_a_largada() {
    let lo = loadout(&[slot(EF_FUEL, AT_PASSIVE, 1, 0, 1.4, -0.1)]);
    let mut run = Run::new_live(GAME_SANDBOX, &seed(4), &lo).unwrap();
    run.step();
    assert_eq!(run.refresh_result()[5] as u32, 1);
}

#[test]
fn loadout_invalido_e_recusado() {
    let boost = slot(EF_BOOST, AT_ACTIVE, 1, 60, 1.5, 0.0);
    assert!(Loadout::parse(&loadout(&[
        boost.clone(),
        boost.clone(),
        boost.clone(),
        boost.clone()
    ]))
    .is_err());
    assert!(Loadout::parse(&loadout(&[boost.clone()])[..10]).is_err());
    assert!(Loadout::parse(&loadout(&[slot(EF_BOOST, 3, 1, 60, 1.5, 0.0)])).is_err());
    assert!(Loadout::parse(&loadout(&[slot(EF_BOOST, AT_ACTIVE, 1, 60, f32::NAN, 0.0)])).is_err());
    assert!(Loadout::parse(&loadout(&[slot(EF_BOOST, AT_ACTIVE, 1, 60, 1.5, -2.0)])).is_err());
    assert!(Loadout::parse(&loadout(&[boost])).is_ok());
}

#[test]
fn tabela_de_jogos_conhece_so_o_que_existe() {
    assert_eq!(
        AnyGame::max_ticks_for(GAME_SANDBOX),
        Some(sandbox::MAX_TICKS)
    );
    assert_eq!(AnyGame::max_ticks_for(99), None);
}
