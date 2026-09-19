//! Value of an attribute, and the place an index range gives it.
//!
//! A Maya attribute is written in several passes: `setAttr ".vt[0:2]"` then `setAttr ".vt[3]"`
//! fill the same array at different ranks. A value is therefore an array that is filled by
//! slices, never a replacement. A rank beyond the driver's element ceiling does not allocate:
//! it is refused, and the caller counts it.
use super::*;

/// Value of an attribute, in the only form the intermediate scene has a use for.
pub(super) enum Attr {
    /// Flat numbers: vertices, edges, normals, angles, colours, texture coordinates.
    Numbers(Vec<f64>),
    /// Strings: a texture file name, a face-component list.
    Texts(Vec<String>),
    /// A boolean: a node's visibility, a shader switch.
    Flag(bool),
    /// Polygonal faces that `.fc` writes, already split into records.
    Faces(Vec<faces::Face>),
}

impl Attr {
    /// Numbers of this attribute, or nothing when it carries none.
    pub(super) fn numbers(&self) -> &[f64] {
        match self {
            Self::Numbers(values) => values,
            _ => &[],
        }
    }
    /// Strings of this attribute.
    pub(super) fn texts(&self) -> &[String] {
        match self {
            Self::Texts(values) => values,
            _ => &[],
        }
    }
    /// Faces of this attribute.
    pub(super) fn faces(&self) -> &[faces::Face] {
        match self {
            Self::Faces(values) => values,
            _ => &[],
        }
    }
    /// Boolean of this attribute. A single number stands in for it: `setAttr ".v" 0` is written
    /// that way.
    pub(super) fn flag(&self) -> Option<bool> {
        match self {
            Self::Flag(value) => Some(*value),
            Self::Numbers(values) => match values.as_slice() {
                [value] => Some(*value != 0.0),
                _ => None,
            },
            _ => None,
        }
    }
    /// First number of this attribute.
    pub(super) fn scalar(&self) -> Option<f64> {
        self.numbers().first().copied()
    }
    /// Three numbers of this attribute — a colour, a translation, three angles.
    pub(super) fn triple(&self) -> Option<[f64; 3]> {
        match self.numbers() {
            [x, y, z, ..] => Some([*x, *y, *z]),
            _ => None,
        }
    }

    /// Pours `values` from rank `at`, filling with neutral values what no command has written
    /// yet. Yields `false` when the variant does not match what is already there, or when the
    /// targeted rank exceeds the element ceiling.
    pub(super) fn splice(&mut self, at: usize, values: Self) -> bool {
        if let Self::Flag(_) = values {
            *self = values;
            return at == 0;
        }
        match (self, values) {
            (Self::Numbers(into), Self::Numbers(from)) => place(into, at, from),
            (Self::Texts(into), Self::Texts(from)) => place(into, at, from),
            (Self::Faces(into), Self::Faces(from)) => place(into, at, from),
            _ => false,
        }
    }

    /// Empty variant of the same form, to receive a first slice.
    pub(super) fn empty_like(&self) -> Self {
        match self {
            Self::Numbers(_) => Self::Numbers(Vec::new()),
            Self::Texts(_) => Self::Texts(Vec::new()),
            Self::Faces(_) => Self::Faces(Vec::new()),
            Self::Flag(value) => Self::Flag(*value),
        }
    }
}

/// Pours `from` into `into` at rank `at`, filling the gap with neutral values.
fn place<T: Clone + Default>(into: &mut Vec<T>, at: usize, from: Vec<T>) -> bool {
    let Some(end) = at
        .checked_add(from.len())
        .filter(|end| *end <= MAX_ELEMENTS)
    else {
        return false;
    };
    if into.len() < end {
        into.resize(end, T::default());
    }
    into[at..end].clone_from_slice(&from);
    true
}

/// Elements of a flat array, `N` numbers per element. What exceeds the last complete element is
/// left: a truncated array does not yield a half-read element.
pub(super) fn elements<const N: usize>(values: &[f64]) -> impl Iterator<Item = [f64; N]> + '_ {
    values.as_chunks::<N>().0.iter().copied()
}
