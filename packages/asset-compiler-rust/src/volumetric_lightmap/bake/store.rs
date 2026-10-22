//! The atlas the bake fills: for every texel of every padded brick the ambient (three floats
//! packed in 32 bits), the six layers of coefficients (four bytes each), the sun's shadowing (a
//! byte) and whether the texel was lit by enough paths to be trusted. A texel is read and written
//! as the floats it holds (`Texel`), through the same roundings the stored formats make.

/// A texel as floats: the ambient, the six layers of coefficients, the shadowing.
pub type Texel = [f32; 28];

/// Floats of a texel up to and including its ambient and coefficients.
const SHADOWING: usize = 27;

pub struct Store {
    pub dims: [usize; 3],
    pub ambient: Vec<u32>,
    pub coefficients: [Vec<[u8; 4]>; 6],
    pub shadowing: Vec<u8>,
    pub valid: Vec<u8>,
}

fn unorm(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// A float in an unsigned small float of `mantissa` bits and a five-bit exponent.
fn small_float(v: f32, mantissa: u32) -> u32 {
    let largest = ((30u32) << mantissa) | ((1 << mantissa) - 1);
    if v.is_nan() || v <= 0.0 {
        return 0;
    }
    let bits = v.to_bits();
    let exponent = (bits >> 23) as i32 - 127;
    let field = if exponent < -14 {
        // Denormal: a multiple of 2^(-14 - mantissa), the nearest even one.
        let scaled = f64::from(v) * 2f64.powi(14 + mantissa as i32);
        round_even(scaled)
    } else {
        let full = (bits & 0x7f_ffff) | 0x80_0000;
        let shift = 23 - mantissa;
        let kept = (full + (1 << (shift - 1)) - 1 + ((full >> shift) & 1)) >> shift;
        (((exponent + 15) as u32) << mantissa) + kept - (1 << mantissa)
    };
    field.min(largest)
}

fn round_even(v: f64) -> u32 {
    let floor = v.floor();
    let diff = v - floor;
    let up = diff > 0.5 || (diff == 0.5 && floor as u64 % 2 == 1);
    (floor as u32) + u32::from(up)
}

fn small_value(field: u32, mantissa: u32) -> f32 {
    let exponent = field >> mantissa;
    let part = (field & ((1 << mantissa) - 1)) as f32;
    let unit = (1u32 << mantissa) as f32;
    if exponent == 0 {
        part / unit * 2f32.powi(-14)
    } else {
        (1.0 + part / unit) * 2f32.powi(exponent as i32 - 15)
    }
}

/// Three floats in the 11, 11 and 10 bits of a packed float colour.
pub fn pack_ambient(c: [f32; 3]) -> u32 {
    small_float(c[0], 6) | (small_float(c[1], 6) << 11) | (small_float(c[2], 5) << 22)
}

pub fn unpack_ambient(packed: u32) -> [f32; 3] {
    [
        small_value(packed & 0x7ff, 6),
        small_value((packed >> 11) & 0x7ff, 6),
        small_value(packed >> 22, 5),
    ]
}

impl Store {
    pub fn new(dims: [usize; 3]) -> Self {
        let texels = dims.iter().product();
        Self {
            dims,
            ambient: vec![0; texels],
            coefficients: std::array::from_fn(|_| vec![[0; 4]; texels]),
            shadowing: vec![0; texels],
            valid: vec![0; texels],
        }
    }

    pub fn index(&self, p: [usize; 3]) -> usize {
        p[0] + self.dims[0] * (p[1] + self.dims[1] * p[2])
    }

    /// The texel `at` as floats.
    pub fn read(&self, at: usize) -> Texel {
        let mut texel = [0.0; 28];
        texel[..3].copy_from_slice(&unpack_ambient(self.ambient[at]));
        for (layer, values) in self.coefficients.iter().enumerate() {
            for k in 0..4 {
                texel[3 + layer * 4 + k] = f32::from(values[at][k]) / 255.0;
            }
        }
        texel[SHADOWING] = f32::from(self.shadowing[at]) / 255.0;
        texel
    }

    /// Stores `texel` at `at`, each part rounded as its format rounds.
    pub fn write(&mut self, at: usize, texel: &Texel) {
        self.ambient[at] = pack_ambient([texel[0], texel[1], texel[2]]);
        for (layer, values) in self.coefficients.iter_mut().enumerate() {
            values[at] = std::array::from_fn(|k| unorm(texel[3 + layer * 4 + k]));
        }
        self.shadowing[at] = unorm(texel[SHADOWING]);
    }

    /// Copies the texel `from` over the texel `to`, with its validity.
    pub fn copy(&mut self, from: usize, to: usize) {
        self.ambient[to] = self.ambient[from];
        for values in &mut self.coefficients {
            values[to] = values[from];
        }
        self.shadowing[to] = self.shadowing[from];
        self.valid[to] = self.valid[from];
    }
}

/// `sum += texel * weight`.
pub fn accumulate(sum: &mut Texel, texel: &Texel, weight: f32) {
    for (s, t) in sum.iter_mut().zip(texel) {
        *s += t * weight;
    }
}

/// `texel * weight`.
pub fn scaled(texel: &Texel, weight: f32) -> Texel {
    texel.map(|v| v * weight)
}
