//! Fronteira WebAssembly da simulação.
//!
//! ABI C crua em vez de wasm-bindgen: a API é pequena (números e buffers), o
//! mesmo .wasm é carregado com `WebAssembly.instantiate` no navegador e no Node,
//! e não há glue JS gerado por uma CLI cuja versão precisaria casar com a crate.
//! Os wrappers são backend/src/services/sim/simRuntime.js e
//! games/client/src/shell/simWasm.ts.
//!
//! Convenção de memória: o JS pede `alloc`, copia bytes, passa ponteiro e
//! tamanho, e libera com `dealloc`. Ponteiros devolvidos por `run_*_ptr` valem
//! até a próxima chamada que mexa na mesma partida.

pub mod bots;
pub mod engine;
pub mod games;
pub mod run;

use run::{Run, ERR_BAD_HANDLE};
use std::cell::RefCell;

/// Suba sempre que qualquer regra mudar. Partida aberta numa versão não pode ser
/// verificada por outra: o backend recusa e devolve vida e itens.
pub const SIM_VERSION: u32 = 3;

thread_local! {
    static RUNS: RefCell<Vec<Option<Box<Run>>>> = const { RefCell::new(Vec::new()) };
}

fn store(run: Run) -> i32 {
    RUNS.with(|runs| {
        let mut runs = runs.borrow_mut();
        let boxed = Some(Box::new(run));
        if let Some(i) = runs.iter().position(Option::is_none) {
            runs[i] = boxed;
            i as i32
        } else {
            runs.push(boxed);
            (runs.len() - 1) as i32
        }
    })
}

fn with_run<R>(handle: i32, f: impl FnOnce(&mut Run) -> R) -> Option<R> {
    RUNS.with(|runs| {
        let mut runs = runs.borrow_mut();
        let slot = runs.get_mut(usize::try_from(handle).ok()?)?;
        slot.as_deref_mut().map(f)
    })
}

unsafe fn bytes<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len as usize)
    }
}

#[no_mangle]
pub extern "C" fn sim_version() -> u32 {
    SIM_VERSION
}

#[no_mangle]
pub extern "C" fn game_max_ticks(game: u32) -> u32 {
    games::AnyGame::max_ticks_for(game).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` precisa ter vindo de `alloc(len)` com o mesmo `len`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: u32) {
    drop(Vec::from_raw_parts(ptr, 0, len as usize));
}

/// # Safety
/// Os pares ponteiro/tamanho precisam apontar para memória válida do módulo.
#[no_mangle]
pub unsafe extern "C" fn run_new(
    game: u32,
    seed_ptr: *const u8,
    seed_len: u32,
    loadout_ptr: *const u8,
    loadout_len: u32,
) -> i32 {
    match Run::new_live(
        game,
        bytes(seed_ptr, seed_len),
        bytes(loadout_ptr, loadout_len),
    ) {
        Ok(run) => store(run),
        Err(code) => code,
    }
}

/// # Safety
/// Os pares ponteiro/tamanho precisam apontar para memória válida do módulo.
#[no_mangle]
pub unsafe extern "C" fn replay_new(
    game: u32,
    seed_ptr: *const u8,
    seed_len: u32,
    loadout_ptr: *const u8,
    loadout_len: u32,
    log_ptr: *const u8,
    log_len: u32,
) -> i32 {
    match Run::new_replay(
        game,
        bytes(seed_ptr, seed_len),
        bytes(loadout_ptr, loadout_len),
        bytes(log_ptr, log_len),
    ) {
        Ok(run) => store(run),
        Err(code) => code,
    }
}

#[no_mangle]
pub extern "C" fn run_set_input(handle: i32, buttons: u32, ax: i32, ay: i32) -> i32 {
    with_run(handle, |r| {
        r.set_input(engine::input::Input::from_raw(buttons, ax, ay))
    })
    .map_or(ERR_BAD_HANDLE, |_| 0)
}

#[no_mangle]
pub extern "C" fn run_attach_bot(handle: i32, seed_hi: u32, seed_lo: u32) -> i32 {
    with_run(handle, |r| {
        r.attach_bot(((seed_hi as u64) << 32) | seed_lo as u64)
    })
    .map_or(ERR_BAD_HANDLE, |_| 0)
}

/// Piloto-robô com nível: 0 aleatório, 1 mediano, 2 p90 (bots::SKILL_*).
#[no_mangle]
pub extern "C" fn run_attach_skill_bot(handle: i32, skill: u32, seed_hi: u32, seed_lo: u32) -> i32 {
    with_run(handle, |r| {
        r.attach_skill_bot(skill, ((seed_hi as u64) << 32) | seed_lo as u64)
    })
    .map_or(ERR_BAD_HANDLE, |_| 0)
}

/// Avança até `n` ticks. Devolve 1 se terminou, 0 se segue, ou código de erro.
#[no_mangle]
pub extern "C" fn run_step(handle: i32, n: u32) -> i32 {
    with_run(handle, |r| {
        for _ in 0..n {
            if r.step() {
                break;
            }
        }
        if r.error() != 0 {
            r.error()
        } else {
            r.ended().is_some() as i32
        }
    })
    .unwrap_or(ERR_BAD_HANDLE)
}

#[no_mangle]
pub extern "C" fn run_quit(handle: i32) -> i32 {
    with_run(handle, |r| r.quit()).map_or(ERR_BAD_HANDLE, |_| 0)
}

#[no_mangle]
pub extern "C" fn run_result(handle: i32) -> *const f64 {
    with_run(handle, |r| r.refresh_result().as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn run_render_len(handle: i32) -> u32 {
    with_run(handle, |r| r.refresh_render().len() as u32).unwrap_or(0)
}

/// Chame depois de `run_render_len`, que é quem atualiza o buffer.
#[no_mangle]
pub extern "C" fn run_render_ptr(handle: i32) -> *const f32 {
    with_run(handle, |r| r.render.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn run_telemetry_len(handle: i32) -> u32 {
    with_run(handle, |r| r.telemetry.len() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn run_telemetry_ptr(handle: i32) -> *const f32 {
    with_run(handle, |r| r.telemetry.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn run_log_len(handle: i32) -> u32 {
    with_run(handle, |r| r.encode_log().len() as u32).unwrap_or(0)
}

/// Chame depois de `run_log_len`, que é quem codifica o log.
#[no_mangle]
pub extern "C" fn run_log_ptr(handle: i32) -> *const u8 {
    with_run(handle, |r| r.log_out.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn run_free(handle: i32) {
    RUNS.with(|runs| {
        if let Some(slot) = runs.borrow_mut().get_mut(handle as usize) {
            *slot = None;
        }
    });
}
