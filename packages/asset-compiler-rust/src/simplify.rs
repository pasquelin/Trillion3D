//! What the region simplifier (`Region::solve_from` and `Region::solve_to`, `simplify/region.rs`) is
//! handed: a region compacted from the level's vertices, its vertex flags and its weighed attributes.
/// The region simplifier.
pub(crate) mod region;
#[cfg(test)]
pub(crate) mod tests;
use trillion3d_math::vector::vec3::{point_checked_f32, unit_where_squared};
use trillion3d_math::vector::vecn::{dot, scale, sub};
use trillion3d_page_codec::encode::vertices::first_use;

/// The squared length a vector the simplifier makes unit must exceed: a corrected normal or
/// tangent (`Corrected`), the outward normal of a border edge (`region/collapse/area.rs`); a
/// shorter one carries no direction and stays as it is.
pub(crate) const UNIT_SQUARED: f32 = 1e-8;

/// `v` made unit when its squared length exceeds `UNIT_SQUARED`, else as it is.
pub(crate) fn unit_or_same(v: [f32; 3]) -> [f32; 3] {
    unit_where_squared(v, |square| square > UNIT_SQUARED).unwrap_or(v)
}

/// How close two points lie, in metres on every axis, to be one point: two hundred nanometres.
/// The build drops a triangle two of whose corners are one point (`dag::DagSettings::
/// drop_near_collapsed`), and a region's frame never measures its mean triangle under it
/// (`region.rs`).
pub const NEAR_POINTS: f32 = 2e-7;
/// The build measures a mesh in centimetres, its source in metres: the factor the faces, the
/// tangent spaces and a region's frame read its positions at, so every tolerance on a length or an
/// area bites where the build's does.
pub(crate) const CENTIMETRES: f32 = 100.0;
/// Region-local vertex buffer plus the table that maps a local index back to its source index:
/// the corners renumbered by first use, as a page's (`first_use`); a vertex past `positions` is
/// placed at the origin.
pub(crate) fn compact_region(positions: &[f32], indices: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let (remap, compact_idx) = first_use(indices.iter().copied());
    let mut compact_pos = Vec::with_capacity(remap.len() * 3);
    for &source in &remap {
        let p = point_checked_f32(positions, source as usize).unwrap_or([0.0; 3]);
        compact_pos.extend_from_slice(&p);
    }
    (compact_pos, compact_idx, remap)
}
/// The region of `corners` with each position welded to its first copy by bits
/// (`weld_positions`), then compacted: its positions, its corners renumbered, and its corners
/// welded in the source numbering. The one sequence a soft body's page ids, its simulation
/// vertices and a convex hull read, so the page and the simulation name the same vertices by
/// construction.
pub(crate) fn welded_region(positions: &[f32], corners: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let canonical = crate::dag::clusters::weld_positions(positions, corners);
    let welded: Vec<u32> = corners.iter().map(|&i| canonical[i as usize]).collect();
    let (xyz, local, _) = compact_region(positions, &welded);
    (xyz, local, welded)
}
/// What a cook's settings hold every solve of its regions to (`dag::DagSettings`), beside the
/// target size.
///
/// `edge_length_bound`: a collapse costs at least the square of each edge it makes over this
/// bound, in the frame's units, where the mean triangle is a quarter to a half of a unit across
/// (`simplify/region.rs`); zero, the default, bounds nothing (`region/collapse/merge.rs`).
///
/// `keep_area`: once a solve is done, the open border of its surface is pushed out by the area its
/// collapses lost (`region/collapse/area.rs`), so a thin shape does not thin out with distance;
/// off by default.
///
/// `hold_texture`: texture coordinates are not solved at a merged position but taken from the
/// vertices the collapse keeps, and count nothing in the error (`dag::attributes::group_weighted`),
/// for texture sets holding values that do not blend, as indices; off by default.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SolveRules {
    pub edge_length_bound: f32,
    pub keep_area: bool,
    pub hold_texture: bool,
}

/// One per-vertex attribute counted in the simplification error: `width` floats per source
/// vertex, each weighted by `weight` in the simplifier's frame, where the mean triangle is a
/// quarter to a half of a unit across (`simplify/region.rs`).
#[derive(Clone, Copy)]
pub struct Attribute<'a> {
    pub values: &'a [f32],
    pub width: usize,
    pub weight: f32,
    pub role: Role,
}

/// What an attribute is to the simplifier: a normal is renormalised, a tangent made unit across
/// the normal and a colour clamped after a solve, a texture set marks its mirrored triangles
/// (`simplify/region/prepare.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Normal,
    /// Four floats: the direction, weighed at the attribute's weight, then the bitangent's sign,
    /// weighed at `TANGENT_SIGN_WEIGHT` (`compact_attributes`).
    Tangent,
    Color,
    Texture,
    /// A vertex's bone influences, weighed at zero: never blended, each wedge takes them whole
    /// from the vertex nearest the merged position (`region/collapse/merge.rs`).
    Bones,
}

/// The weight of a tangent's bitangent sign in the error, whatever its direction's.
pub(crate) const TANGENT_SIGN_WEIGHT: f32 = 0.5;

/// Where the attributes a solve corrects sit among a vertex's attribute floats: the normal's
/// three, renormalised — the pages draw unit normals, and a solved one is a blend —; the
/// tangent's four, its direction made unit across that normal and its sign `±1`; and the
/// colour's, clamped to [0, 1], the range a page stores. The build corrects its source the same
/// way before anything (`dag::input`).
#[derive(Clone, Copy, Default)]
pub struct Corrected {
    pub normal: Option<usize>,
    pub tangent: Option<usize>,
    pub color: Option<(usize, usize)>,
}
impl Corrected {
    /// The first normal, the first tangent and the first colour among `attributes`, by their
    /// floats' offsets.
    pub fn of(attributes: &[Attribute]) -> Self {
        let mut corrected = Self::default();
        let mut at = 0;
        for a in attributes {
            match a.role {
                Role::Normal if corrected.normal.is_none() => corrected.normal = Some(at),
                Role::Tangent if corrected.tangent.is_none() => corrected.tangent = Some(at),
                Role::Color if corrected.color.is_none() => corrected.color = Some((at, a.width)),
                _ => {}
            }
            at += a.width;
        }
        corrected
    }
    /// Whether it corrects anything: a normal, a tangent or a colour.
    pub fn any(&self) -> bool {
        self.normal.is_some() || self.tangent.is_some() || self.color.is_some()
    }
    pub fn apply(&self, attributes: &mut [f32]) {
        let mut normal = None;
        if let Some(at) = self.normal {
            // A blend shorter than 1e-4 has no direction to keep: it stays as solved.
            let n = &mut attributes[at..at + 3];
            let unit = unit_or_same([n[0], n[1], n[2]]);
            n.copy_from_slice(&unit);
            normal = Some(unit);
        }
        if let Some(at) = self.tangent {
            // Its part along the normal taken away, then made unit when it keeps a direction.
            let t = &mut attributes[at..at + 4];
            let mut direction = [t[0], t[1], t[2]];
            if let Some(n) = normal {
                direction = sub(direction, scale(n, dot(direction, n)));
            }
            t[..3].copy_from_slice(&unit_or_same(direction));
            t[3] = if t[3] < 0.0 { -1.0 } else { 1.0 };
        }
        if let Some((at, width)) = self.color {
            for c in &mut attributes[at..at + width] {
                *c = c.clamp(0.0, 1.0);
            }
        }
    }
}

/// Vertex `source`'s `width` values of `values`, appended to `out`: the one compaction of an
/// attribute. Every producer carries an attribute on every vertex: a vertex missing from one is a
/// cook defect, refused here by the index rather than drawn black or flat.
pub(crate) fn push_vertex(out: &mut Vec<f32>, values: &[f32], width: usize, source: u32) {
    let at = source as usize * width;
    out.extend_from_slice(&values[at..at + width]);
}

/// The attributes of the region's vertices, interleaved in compact order, and one weight per float:
/// the attribute's, but a tangent's sign at `TANGENT_SIGN_WEIGHT`.
pub(crate) fn compact_attributes(attributes: &[Attribute], remap: &[u32]) -> (Vec<f32>, Vec<f32>) {
    let weights: Vec<f32> = attributes
        .iter()
        .flat_map(|a| {
            (0..a.width).map(move |at| match a.role {
                Role::Tangent if at == 3 => TANGENT_SIGN_WEIGHT,
                _ => a.weight,
            })
        })
        .collect();
    let mut values = Vec::with_capacity(remap.len() * weights.len());
    for &source in remap {
        for a in attributes {
            push_vertex(&mut values, a.values, a.width, source);
        }
    }
    (values, weights)
}
