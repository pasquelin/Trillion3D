//! A USD primvar and how it is read at a face corner.
//!
//! USD stores a value per vertex, per corner, per face or for the whole surface, and can also
//! index the array. A primvar is therefore always read in two steps: which rank of the array
//! this corner depends on, then which value that rank carries. It is that first rank that
//! serves as the glTF vertex deduplication key — two corners that cite the same rank share a
//! vertex.
use super::*;
use crate::plugins::scene::spread::Spread;

/// Spread the layer declares, or the one the array length names when it does not declare it: a
/// primvar as long as the points follows the points, as long as the corners follows the
/// corners. That is what a reader that refuses to guess at random does.
fn declared_spread(declared: Option<&str>, values: usize, points: usize, corners: usize) -> Spread {
    match declared {
        Some("constant") => Spread::Constant,
        Some("uniform") => Spread::Uniform,
        Some("vertex" | "varying") => Spread::Point,
        Some("faceVarying") => Spread::FaceVarying,
        _ if values == points => Spread::Point,
        _ if values == corners => Spread::FaceVarying,
        _ if values <= 1 => Spread::Constant,
        _ => Spread::FaceVarying,
    }
}

/// A primvar as read: its values, its indices when it has some, and its spread.
pub(super) struct Primvar<T> {
    values: Vec<T>,
    indices: Option<Vec<i64>>,
    spread: Spread,
}

impl<T: Copy> Primvar<T> {
    pub(super) fn new(values: Vec<T>, indices: Option<Vec<i64>>, spread: Spread) -> Self {
        Self {
            values,
            indices,
            spread,
        }
    }
    /// Rank of the array this corner depends on: the one rule of `Spread::slot`.
    pub(super) fn slot(&self, corner: usize, face: usize, point: usize) -> Option<u32> {
        self.spread
            .slot(self.indices.as_deref(), corner, face, point)
    }
    /// Value of a rank, or `None` when the array is shorter than what the indices say.
    pub(super) fn get(&self, slot: u32) -> Option<T> {
        self.values.get(slot as usize).copied()
    }
}

/// A primvar as the layer writes it, before any spread is chosen for it: its values, its indices when
/// it has some, the interpolation it names, and whether a time sample answered.
pub(super) struct Written<T> {
    pub(super) values: Vec<T>,
    pub(super) indices: Option<Vec<i64>>,
    pub(super) interpolation: Option<String>,
    pub(super) sampled: bool,
}

impl<T: Clone> Written<T> {
    /// The values behind the indices, those of the primvar itself when it has none; `None` when an
    /// index leaves them.
    pub(super) fn flattened(self) -> Option<Vec<T>> {
        let Some(indices) = self.indices else {
            return Some(self.values);
        };
        indices
            .iter()
            .map(|&slot| self.values.get(usize::try_from(slot).ok()?).cloned())
            .collect()
    }
}

/// Reads the primvar `name` of a prim as the layer writes it: its value, its `<name>:indices`, its
/// declared interpolation.
pub(super) fn written<T>(
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
) -> Option<Written<T>> {
    let attribute = prim.attribute(name);
    let (value, mut sampled) = read::first(&attribute)?;
    let values = decode(&value)?;
    let indices = match read::first(&prim.attribute(format!("{name}:indices"))) {
        Some((value, from_sample)) => {
            sampled |= from_sample;
            read::integers(&value)
        }
        None => None,
    };
    Some(Written {
        values,
        indices,
        interpolation: read::metadata(&attribute, "interpolation"),
        sampled,
    })
}

/// Reads a primvar of a prim: its value, its `<name>:indices`, its declared spread. Also yields
/// `true` when either of the two values comes from a time sample.
pub(super) fn read<T: Copy>(
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
    points: usize,
    corners: usize,
) -> Option<(Primvar<T>, bool)> {
    let written = written(prim, name, decode)?;
    let spread = declared_spread(
        written.interpolation.as_deref(),
        written.values.len(),
        points,
        corners,
    );
    Some((
        Primvar::new(written.values, written.indices, spread),
        written.sampled,
    ))
}
