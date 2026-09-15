//! FNV-1a de 64 bits sobre os campos canônicos do estado.
//!
//! Serve para uma coisa só: provar que duas execuções da mesma partida (no
//! navegador e no verificador) passaram pelos mesmos estados. Não é hash
//! criptográfico e não precisa ser — ninguém ganha nada forjando um hash, porque
//! o servidor recalcula o resultado inteiro a partir das entradas.

pub struct Fnv64(u64);

impl Fnv64 {
    pub const fn new() -> Self {
        Fnv64(0xcbf2_9ce4_8422_2325)
    }

    pub fn write_bytes(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 ^= b as u64;
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    pub fn write_u8(&mut self, v: u8) {
        self.write_bytes(&[v]);
    }

    pub fn write_u32(&mut self, v: u32) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_u64(&mut self, v: u64) {
        self.write_bytes(&v.to_le_bytes());
    }

    /// Os bits exatos do float, não o valor arredondado: dois estados que só
    /// diferem na 7ª casa decimal já divergiram e vão se afastar.
    pub fn write_f32(&mut self, v: f32) {
        self.write_u32(v.to_bits());
    }

    pub fn finish(&self) -> u64 {
        self.0
    }
}

impl Default for Fnv64 {
    fn default() -> Self {
        Self::new()
    }
}
