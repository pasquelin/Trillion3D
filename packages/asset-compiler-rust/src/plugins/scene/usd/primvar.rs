//! A USD primvar and how it is read at a face corner.
//!
//! USD stores a value per vertex, per corner, per face or for the whole surface, and can also
//! index the array. A primvar is therefore always read in two steps: which rank of the array
//! this corner depends on, then which value that rank carries. It is that first rank that
//! serves as the glTF vertex deduplication key — two corners that cite the same rank share a
//! vertex.
use super::*;

/// How a primvar is spread over the surface.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Spread {
    /// A single value for the whole surface.
    Constant,
    /// One value per face.
    Uniform,
    /// One value per point, cited by the face's vertex index.
    Point,
    /// One value per face corner.
    FaceVarying,
}

impl Spread {
    /// Spread the layer declares, or the one the array length names when it does not declare
    /// it: a primvar as long as the points follows the points, as long as the corners follows
    /// the corners. That is what a reader that refuses to guess at random does.
    pub(super) fn read(
        declared: Option<&str>,
        values: usize,
        points: usize,
        corners: usize,
    ) -> Self {
        match declared {
            Some("constant") => Self::Constant,
            Some("uniform") => Self::Uniform,
            Some("vertex" | "varying") => Self::Point,
            Some("faceVarying") => Self::FaceVarying,
            _ if values == points => Self::Point,
            _ if values == corners => Self::FaceVarying,
            _ if values <= 1 => Self::Constant,
            _ => Self::FaceVarying,
        }
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
    /// Rank of the array this corner depends on. `corner` is the corner's rank in the whole
    /// surface, `face` that of its face, `point` the point index the face cites at this corner.
    /// A rank that leaves the index array, or a negative index, names nothing: `None`, never
    /// rank zero, which would give this corner another corner's value.
    pub(super) fn slot(&self, corner: usize, face: usize, point: usize) -> Option<u32> {
        let raw = match self.spread {
            Spread::Constant => 0,
            Spread::Uniform => face,
            Spread::Point => point,
            Spread::FaceVarying => corner,
        };
        let Some(indices) = &self.indices else {
            return u32::try_from(raw).ok();
        };
        u32::try_from(*indices.get(raw)?).ok()
    }
    /// Value of a rank, or `None` when the array is shorter than what the indices say.
    pub(super) fn get(&self, slot: u32) -> Option<T> {
        self.values.get(slot as usize).copied()
    }
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
    let declared = read::metadata(&attribute, "interpolation");
    let spread = Spread::read(declared.as_deref(), values.len(), points, corners);
    Some((Primvar::new(values, indices, spread), sampled))
}
