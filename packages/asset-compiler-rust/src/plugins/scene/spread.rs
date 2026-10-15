//! How a per-corner attribute spreads over a surface, and the rank a face corner reads in it.
//!
//! USD primvars and Alembic geometry parameters say the same thing in two vocabularies: one
//! value for the whole surface, one per face, one per point, or one per face corner, each
//! optionally behind an index table. A corner is therefore always read in two steps — which
//! rank its spread names, then which value the index table puts there — and that rank is the
//! glTF vertex deduplication key: two corners that cite the same rank share a vertex.

/// How an attribute is spread over the surface.
#[derive(Clone, Copy, PartialEq, Eq)]
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
    /// Rank of the array this corner depends on. `corner` is the corner's rank in the whole
    /// surface, `face` that of its face, `point` the point index the face cites at this corner.
    /// A rank that leaves the index table, or an index that is no rank, names nothing: `None`,
    /// never rank zero, which would give this corner another corner's value.
    pub(super) fn slot<I: Copy>(
        self,
        indices: Option<&[I]>,
        corner: usize,
        face: usize,
        point: usize,
    ) -> Option<u32>
    where
        u32: TryFrom<I>,
    {
        let raw = match self {
            Self::Constant => 0,
            Self::Uniform => face,
            Self::Point => point,
            Self::FaceVarying => corner,
        };
        match indices {
            Some(indices) => u32::try_from(*indices.get(raw)?).ok(),
            None => <u32 as TryFrom<usize>>::try_from(raw).ok(),
        }
    }
}
