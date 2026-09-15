//! Entrada por tick e o log de entradas que o cliente envia ao servidor.
//!
//! O log mora só aqui, em Rust: o navegador empurra a entrada de cada tick para
//! o .wasm, que grava; o servidor entrega os bytes ao mesmo .wasm, que decodifica.
//! Um codec escrito uma segunda vez em TypeScript seria um segundo lugar para
//! divergir — e divergência aqui é partida legítima rejeitada.
//!
//! Formato (versão 1):
//!   [u8 versão][varint nº de registros]
//!   registros: [varint ticks desde o anterior][u16 LE botões][i8 eixo X][i8 eixo Y]
//!   [varint tick final]
//! Só entram mudanças de entrada, então 120 s de partida cabem em poucos KB.

pub const BTN_ACTION_A: u16 = 1 << 0;
pub const BTN_ACTION_B: u16 = 1 << 1;
pub const BTN_USE_ITEM: u16 = 1 << 2;
pub const BTN_SWITCH_ITEM: u16 = 1 << 3;
pub const BTN_THROTTLE: u16 = 1 << 4;
pub const BTN_BRAKE: u16 = 1 << 5;
pub const BTN_MASK: u16 = 0x3F;

pub const LOG_VERSION: u8 = 1;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Input {
    pub buttons: u16,
    pub ax: i8,
    pub ay: i8,
}

impl Input {
    /// Normaliza o que chega do JS. -128 fica de fora para o eixo ser simétrico:
    /// -127..127 mapeia para -1..1 sem um lado ter um degrau a mais.
    pub fn from_raw(buttons: u32, ax: i32, ay: i32) -> Input {
        Input {
            buttons: (buttons as u16) & BTN_MASK,
            ax: ax.clamp(-127, 127) as i8,
            ay: ay.clamp(-127, 127) as i8,
        }
    }

    pub fn held(&self, btn: u16) -> bool {
        self.buttons & btn != 0
    }

    /// Borda de subida: ação que dispara uma vez por aperto (usar item, trocar
    /// item), não a cada tick com o botão segurado.
    pub fn pressed(&self, prev: &Input, btn: u16) -> bool {
        self.held(btn) && !prev.held(btn)
    }

    pub fn axis_x(&self) -> f32 {
        self.ax as f32 / 127.0
    }

    pub fn axis_y(&self) -> f32 {
        self.ay as f32 / 127.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct InputRecord {
    pub tick: u32,
    pub input: Input,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LogError {
    BadVersion,
    Truncated,
    VarintOverflow,
    TooManyRecords,
    NonMonotonic,
    InvalidInput,
    RedundantRecord,
    ExceedsMaxTicks,
    RecordAfterEnd,
    TrailingBytes,
}

pub struct LogRecorder {
    records: Vec<InputRecord>,
    last: Input,
}

impl LogRecorder {
    pub fn new() -> Self {
        LogRecorder {
            records: Vec::new(),
            last: Input::default(),
        }
    }

    /// Chamado uma vez por tick, antes de simular. Grava só quando muda.
    pub fn observe(&mut self, tick: u32, input: Input) {
        if input != self.last {
            self.records.push(InputRecord { tick, input });
            self.last = input;
        }
    }

    pub fn encode(&self, end_tick: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + self.records.len() * 6);
        out.push(LOG_VERSION);
        write_varint(&mut out, self.records.len() as u32);
        let mut prev_tick = 0u32;
        for r in &self.records {
            write_varint(&mut out, r.tick - prev_tick);
            out.extend_from_slice(&r.input.buttons.to_le_bytes());
            out.push(r.input.ax as u8);
            out.push(r.input.ay as u8);
            prev_tick = r.tick;
        }
        write_varint(&mut out, end_tick);
        out
    }
}

impl Default for LogRecorder {
    fn default() -> Self {
        Self::new()
    }
}

pub struct DecodedLog {
    pub records: Vec<InputRecord>,
    pub end_tick: u32,
}

/// Decodifica e valida. Recusa tudo que o gravador acima nunca produziria: um
/// log fora da forma canônica só pode ter sido montado à mão.
pub fn decode_log(bytes: &[u8], max_ticks: u32) -> Result<DecodedLog, LogError> {
    if bytes.first() != Some(&LOG_VERSION) {
        return Err(LogError::BadVersion);
    }
    let mut pos = 1usize;
    let count = read_varint(bytes, &mut pos)?;
    if count > max_ticks {
        return Err(LogError::TooManyRecords);
    }

    let mut records = Vec::with_capacity(count as usize);
    let mut tick = 0u32;
    let mut prev = Input::default();
    for i in 0..count {
        let delta = read_varint(bytes, &mut pos)?;
        // Só o primeiro registro pode estar no tick 0 sem avançar.
        if i > 0 && delta == 0 {
            return Err(LogError::NonMonotonic);
        }
        tick = tick.checked_add(delta).ok_or(LogError::VarintOverflow)?;
        if pos + 4 > bytes.len() {
            return Err(LogError::Truncated);
        }
        let buttons = u16::from_le_bytes([bytes[pos], bytes[pos + 1]]);
        let ax = bytes[pos + 2] as i8;
        let ay = bytes[pos + 3] as i8;
        pos += 4;
        if buttons & !BTN_MASK != 0 || ax == i8::MIN || ay == i8::MIN {
            return Err(LogError::InvalidInput);
        }
        let input = Input { buttons, ax, ay };
        if input == prev {
            return Err(LogError::RedundantRecord);
        }
        prev = input;
        records.push(InputRecord { tick, input });
    }

    let end_tick = read_varint(bytes, &mut pos)?;
    if end_tick > max_ticks {
        return Err(LogError::ExceedsMaxTicks);
    }
    if let Some(last) = records.last() {
        // Entrada gravada no tick final nunca chega a ser aplicada.
        if last.tick >= end_tick {
            return Err(LogError::RecordAfterEnd);
        }
    }
    if pos != bytes.len() {
        return Err(LogError::TrailingBytes);
    }
    Ok(DecodedLog { records, end_tick })
}

fn write_varint(out: &mut Vec<u8>, mut v: u32) {
    loop {
        let byte = (v & 0x7F) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn read_varint(bytes: &[u8], pos: &mut usize) -> Result<u32, LogError> {
    let mut result = 0u32;
    let mut shift = 0u32;
    loop {
        let byte = *bytes.get(*pos).ok_or(LogError::Truncated)?;
        *pos += 1;
        // O 5º byte só tem 4 bits úteis num u32.
        if shift == 28 && byte > 0x0F {
            return Err(LogError::VarintOverflow);
        }
        result |= ((byte & 0x7F) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
        shift += 7;
        if shift > 28 {
            return Err(LogError::VarintOverflow);
        }
    }
}
