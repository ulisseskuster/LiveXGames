//! Gerador pseudoaleatório da partida: xoshiro256**, semeado por SplitMix64.
//!
//! Toda aleatoriedade da simulação sai daqui. Relógio, Math.random ou qualquer
//! fonte externa quebrariam o replay: o verificador precisa sortear exatamente
//! os mesmos obstáculos que o navegador sorteou.

use super::hash::Fnv64;

#[derive(Clone)]
pub struct Prng {
    s: [u64; 4],
}

impl Prng {
    /// A semente vem do servidor como bytes arbitrários. O FNV condensa em 64
    /// bits e o SplitMix64 espalha para os 256 bits de estado — e nunca produz o
    /// estado todo-zero, que travaria o xoshiro.
    pub fn from_seed_bytes(seed: &[u8]) -> Prng {
        let mut h = Fnv64::new();
        h.write_bytes(seed);
        Prng::from_u64(h.finish())
    }

    pub fn from_u64(seed: u64) -> Prng {
        let mut x = seed;
        let mut s = [0u64; 4];
        for slot in s.iter_mut() {
            x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = x;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            *slot = z ^ (z >> 31);
        }
        Prng { s }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniforme em [0, 1). 24 bits porque é o que um f32 representa sem
    /// arredondar: com mais bits, dois inteiros diferentes virariam o mesmo float.
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u32 << 24) as f32
    }

    pub fn range_f32(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next_f32()
    }

    /// Inteiro uniforme em [0, n). Multiplicação em vez de módulo para não
    /// favorecer os valores baixos.
    pub fn below(&mut self, n: u32) -> u32 {
        (((self.next_u64() >> 32) * n as u64) >> 32) as u32
    }

    pub fn state_hash(&self, h: &mut Fnv64) {
        for v in self.s {
            h.write_u64(v);
        }
    }
}
