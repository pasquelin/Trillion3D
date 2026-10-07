//! A golden file's values: each typed, written by its exact bits.

/// One input or output of a case.
#[derive(Clone, Copy, Debug)]
pub enum Value {
    F64(f64),
    F32(f32),
    U32(u32),
    I32(i32),
}

impl Value {
    pub fn f64(self) -> f64 {
        match self {
            Value::F64(value) => value,
            other => panic!("{other:?} is not an f64"),
        }
    }
    pub fn f32(self) -> f32 {
        match self {
            Value::F32(value) => value,
            other => panic!("{other:?} is not an f32"),
        }
    }
    pub fn u32(self) -> u32 {
        match self {
            Value::U32(value) => value,
            other => panic!("{other:?} is not a u32"),
        }
    }
    pub fn i32(self) -> i32 {
        match self {
            Value::I32(value) => value,
            other => panic!("{other:?} is not an i32"),
        }
    }

    /// The value as the file writes it, a NaN as the quiet NaN of its width.
    pub(super) fn token(self) -> String {
        match self {
            Value::F64(v) => format!(
                "f64:{:016x}",
                if v.is_nan() { f64::NAN } else { v }.to_bits()
            ),
            Value::F32(v) => format!(
                "f32:{:08x}",
                if v.is_nan() { f32::NAN } else { v }.to_bits()
            ),
            Value::U32(v) => format!("u32:{v}"),
            Value::I32(v) => format!("i32:{v}"),
        }
    }

    pub(super) fn parse(token: &str) -> Value {
        let (kind, text) = token.split_once(':').expect("a typed value");
        match kind {
            "f64" => Value::F64(f64::from_bits(
                u64::from_str_radix(text, 16).expect("f64 bits"),
            )),
            "f32" => Value::F32(f32::from_bits(
                u32::from_str_radix(text, 16).expect("f32 bits"),
            )),
            "u32" => Value::U32(text.parse().expect("an unsigned integer")),
            "i32" => Value::I32(text.parse().expect("a signed integer")),
            _ => panic!("unknown value kind {kind}"),
        }
    }

    /// The same value: the same kind and bits, or two NaN of one width.
    pub(super) fn matches(self, other: Value) -> bool {
        match (self, other) {
            (Value::F64(a), Value::F64(b)) => {
                a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan()
            }
            (Value::F32(a), Value::F32(b)) => {
                a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan()
            }
            (Value::U32(a), Value::U32(b)) => a == b,
            (Value::I32(a), Value::I32(b)) => a == b,
            _ => false,
        }
    }
}

/// The values of `values` as `f64` inputs or outputs.
pub fn f64s(values: &[f64]) -> Vec<Value> {
    values.iter().map(|&v| Value::F64(v)).collect()
}

/// The values of `values` as `f32` inputs or outputs.
pub fn f32s(values: &[f32]) -> Vec<Value> {
    values.iter().map(|&v| Value::F32(v)).collect()
}

/// Hostile `f64` values: signed zeros, subnormals, the extremes, infinities and NaN, beside
/// ordinary ones.
pub const HOSTILE_F64: [f64; 16] = [
    0.0,
    -0.0,
    1.0,
    -1.0,
    0.5,
    -2.0,
    1e308,
    -1e308,
    1e-320,
    -1e-320,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NAN,
    3.0000000000000004,
    1e154,
    -1e154,
];

/// The `i`-th draw of a Weyl sequence in `[-100, 100)`: multiples of `GOLDEN`, their top 53 bits.
pub fn ordinary(i: u64) -> f64 {
    (i.wrapping_mul(crate::GOLDEN) >> 11) as f64 / (1u64 << 53) as f64 * 200.0 - 100.0
}
