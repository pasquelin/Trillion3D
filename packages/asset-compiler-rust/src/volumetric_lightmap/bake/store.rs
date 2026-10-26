//! The atlas the bake fills: for every texel of every padded brick the ambient (three floats
//! packed in 32 bits), the six layers of coefficients (four bytes each), the sky's bent normal
//! (four bytes), the sun's shadowing (a byte) and whether the texel was lit by enough paths to be
//! trusted. A texel is read and written as the floats it holds (`Texel`), through the same
//! roundings the stored formats make.

use crate::volumetric_lightmap::LightmapCell;
use trillion3d_math::scalar::unit_to_byte_f32 as unorm;

/// The floats of a texel: the ambient, the six layers of coefficients, the shadowing, the bent
/// normal.
pub const TEXEL_FLOATS: usize = 31;
/// A texel as floats.
pub type Texel = [f32; TEXEL_FLOATS];

/// Where the shadowing is in a texel, after the ambient and the coefficients.
const SHADOWING: usize = 27;
/// Where the bent normal's three floats start, after the shadowing.
pub const BENT: usize = 28;
/// The alpha of a bent normal's texel: a half, as nothing is gathered in it.
const BENT_ALPHA: u8 = 128;

/// The stored parts of one texel, as the layers hold them.
struct Held {
    ambient: u32,
    coefficients: [[u8; 4]; 6],
    bent: Option<[u8; 4]>,
    shadowing: u8,
    valid: u8,
}

pub struct Store {
    pub dims: [usize; 3],
    pub ambient: Vec<u32>,
    pub coefficients: [Vec<[u8; 4]>; 6],
    /// The bent normal's texels, none where the bake gathers none.
    pub bent: Vec<[u8; 4]>,
    pub shadowing: Vec<u8>,
    pub valid: Vec<u8>,
    /// Per brick, the mean over its probes of the distance to the nearest geometry, in metres.
    pub distance: Vec<f32>,
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
    /// An atlas of `dims` texels, holding the bent normal's where `bent`.
    pub fn new(dims: [usize; 3], bent: bool) -> Self {
        let texels: usize = dims.iter().product();
        Self {
            dims,
            ambient: vec![0; texels],
            coefficients: std::array::from_fn(|_| vec![[0; 4]; texels]),
            bent: vec![[0; 4]; if bent { texels } else { 0 }],
            shadowing: vec![0; texels],
            valid: vec![0; texels],
            distance: Vec::new(),
        }
    }

    pub fn index(&self, p: [usize; 3]) -> usize {
        p[0] + self.dims[0] * (p[1] + self.dims[1] * p[2])
    }

    /// The texel `at` as floats.
    pub fn read(&self, at: usize) -> Texel {
        let mut texel = [0.0; TEXEL_FLOATS];
        texel[..3].copy_from_slice(&unpack_ambient(self.ambient[at]));
        for (layer, values) in self.coefficients.iter().enumerate() {
            for k in 0..4 {
                texel[3 + layer * 4 + k] = f32::from(values[at][k]) / 255.0;
            }
        }
        texel[SHADOWING] = f32::from(self.shadowing[at]) / 255.0;
        if let Some(held) = self.bent.get(at) {
            for k in 0..3 {
                texel[BENT + k] = f32::from(held[k]) / 255.0;
            }
        }
        texel
    }

    /// Stores `texel` at `at`, each part rounded as its format rounds.
    pub fn write(&mut self, at: usize, texel: &Texel) {
        self.ambient[at] = pack_ambient([texel[0], texel[1], texel[2]]);
        for (layer, values) in self.coefficients.iter_mut().enumerate() {
            values[at] = std::array::from_fn(|k| unorm(texel[3 + layer * 4 + k]));
        }
        self.shadowing[at] = unorm(texel[SHADOWING]);
        if let Some(held) = self.bent.get_mut(at) {
            let [x, y, z] = [0, 1, 2].map(|k| unorm(texel[BENT + k]));
            *held = [x, y, z, BENT_ALPHA];
        }
    }

    /// Copies the texel `from` over the texel `to`, with its validity.
    pub fn copy(&mut self, from: usize, to: usize) {
        let held = self.held(from);
        self.hold(to, held);
    }

    /// Copies the texel `from` of this atlas over the texel `to` of `target`, with its validity.
    pub fn copy_texel(&self, from: usize, target: &mut Store, to: usize) {
        target.hold(to, self.held(from));
    }

    /// Appends the bytes of the texel `at` to the layers of `cell`, in the file's layer order.
    pub fn push_texel_bytes(&self, at: usize, cell: &mut LightmapCell) {
        cell.ambient.extend(self.ambient[at].to_le_bytes());
        for (into, from) in cell.coefficients.iter_mut().zip(&self.coefficients) {
            into.extend(from[at]);
        }
        if !self.bent.is_empty() {
            cell.sky_bent_normal.extend(self.bent[at]);
        }
        cell.directional_shadowing.push(self.shadowing[at]);
    }

    /// The stored parts of the texel `at`: the one list of layers a texel is made of.
    fn held(&self, at: usize) -> Held {
        Held {
            ambient: self.ambient[at],
            coefficients: std::array::from_fn(|layer| self.coefficients[layer][at]),
            bent: self.bent.get(at).copied(),
            shadowing: self.shadowing[at],
            valid: self.valid[at],
        }
    }

    fn hold(&mut self, at: usize, held: Held) {
        self.ambient[at] = held.ambient;
        for (values, part) in self.coefficients.iter_mut().zip(held.coefficients) {
            values[at] = part;
        }
        if let (Some(slot), Some(part)) = (self.bent.get_mut(at), held.bent) {
            *slot = part;
        }
        self.shadowing[at] = held.shadowing;
        self.valid[at] = held.valid;
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
