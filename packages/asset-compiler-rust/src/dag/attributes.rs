//! The vertex attributes a reduction answers for: normals, stored tangents, texture sets and the
//! colour count in the simplification error, each at the weight of what it changes on screen, and
//! each copy of a position keeps its own (`simplify/region/collapse.rs`); the bones count nothing
//! but tell copies apart, and a placed vertex takes them whole (`bones`).
use super::clusters::{position_key, weld_by};
use crate::simplify;
use smallvec::SmallVec;
use trillion3d_math::scalar::normalized_bits;
use trillion3d_page_codec::encode::deformation::Deformation;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_SKIN, FLAG_TANGENT, UV_FLAGS};

/// Every attribute the build carries beside the positions: what the pages carry — the normal,
/// the stored tangent, every texture set the mesh has, the colour —, and the bones (`bones`),
/// which no page reads from there.
#[derive(Clone, Copy, Default)]
pub struct DagAttributes<'a> {
    pub carried: &'a [&'a Attribute],
}

/// A primitive's bone influences as the attribute the build carries beside the pages' own
/// (`FLAG_SKIN`): per vertex, each influence's joint then its weight, as floats; none without a
/// skin. Every weld tells two copies apart by it, the simplifier weighs it at zero
/// (`simplify::Role::Bones`), so a placed vertex takes the bones of the vertex nearest its
/// position, and the page reads that vertex's deformation for it (`grown::Placed`).
pub(crate) fn bones(deformation: &Deformation) -> Option<Attribute> {
    let (joints, weights) = deformation.skin.as_ref()?;
    let pairs = joints
        .iter()
        .zip(weights)
        .flat_map(|(&joint, &weight)| [joint as f32, weight]);
    Some(Attribute {
        flag: FLAG_SKIN,
        width: 2 * deformation.influences,
        values: pairs.collect(),
    })
}
impl<'a> DagAttributes<'a> {
    fn values(&self, flag: u32) -> impl Iterator<Item = &'a [f32]> {
        self.carried
            .iter()
            .filter(move |a| a.flag == flag)
            .map(|a| &a.values[..])
    }
    /// Two floats per vertex per texture set; empty without one.
    pub fn uv_sets(&self) -> Vec<&'a [f32]> {
        UV_FLAGS
            .into_iter()
            .flat_map(|flag| self.values(flag))
            .collect()
    }
    /// The carried attributes the simplifier weighs, in its order — the normal, the stored tangent
    /// when the mesh stores its tangents, the colour, every texture set, then the bones — at their
    /// weight in the simplifier's frame, where the mean triangle is a quarter to a half of a unit
    /// across (`simplify/region.rs`): each normal float 1, each tangent direction float and colour
    /// channel 1/16 — the tangent's sign 1/2 (`simplify::TANGENT_SIGN_WEIGHT`) —, a texture
    /// coordinate by the group's texture density (`group_weighted`), a bone float 0.
    pub(crate) fn weighted(&self) -> Vec<simplify::Attribute<'a>> {
        let with = |flag| self.carried.iter().copied().filter(move |a| a.flag == flag);
        let attribute = |role: simplify::Role, weight: f32| {
            move |a: &'a Attribute| simplify::Attribute {
                values: &a.values,
                width: a.width,
                weight,
                role,
            }
        };
        let normals = with(FLAG_NORMAL)
            .take(1)
            .map(attribute(simplify::Role::Normal, 1.0));
        let tangents = with(FLAG_TANGENT)
            .take(1)
            .map(attribute(simplify::Role::Tangent, 0.0625));
        let colours = with(FLAG_COLOR)
            .take(1)
            .map(attribute(simplify::Role::Color, 0.0625));
        let uvs = (UV_FLAGS.into_iter().flat_map(|flag| with(flag)))
            .map(attribute(simplify::Role::Texture, 1.0));
        let bones = with(FLAG_SKIN)
            .take(1)
            .map(attribute(simplify::Role::Bones, 0.0));
        normals
            .chain(tangents)
            .chain(colours)
            .chain(uvs)
            .chain(bones)
            .collect()
    }
}

/// Where `attribute` sits in a solved row — a vertex's weighed floats, the attributes of
/// `weighted` one after the other —: after the floats of those before it; none for one the
/// simplifier does not weigh.
pub(crate) fn row_offset(weighted: &[simplify::Attribute], attribute: &Attribute) -> Option<usize> {
    let at = (weighted.iter()).position(|w| std::ptr::eq(w.values, &attribute.values[..]))?;
    Some(weighted[..at].iter().map(|w| w.width).sum::<usize>())
}

/// `weighted` with each texture set at its weight for one group, over the group's triangles
/// `live`, in single precision: 1 / (128 · size), `size` the mean triangle's size in texture space
/// — the square root of the sum of its triangles' texture areas, each half the absolute cross of
/// its two edges from its first corner, a triangle after the other, over their count —, held at
/// 1/1024 or more; zero when the `rules` hold texture coordinates (`SolveRules::hold_texture`).
pub(crate) fn group_weighted<'a>(
    weighted: &[simplify::Attribute<'a>],
    live: &[u32],
    rules: simplify::SolveRules,
) -> Vec<simplify::Attribute<'a>> {
    let triangles = live.as_chunks::<3>().0;
    let uv_weight = |uvs: &[f32]| {
        if rules.hold_texture {
            return 0.0;
        }
        let uv = |v: u32| [uvs[v as usize * 2], uvs[v as usize * 2 + 1]];
        let mut uv_area = 0.0_f32;
        for t in triangles {
            let ([u0, v0], [u1, v1], [u2, v2]) = (uv(t[0]), uv(t[1]), uv(t[2]));
            let (edge1, edge2) = ([u1 - u0, v1 - v0], [u2 - u0, v2 - v0]);
            uv_area += (0.5 * (edge1[0] * edge2[1] - edge1[1] * edge2[0])).abs();
        }
        let size = (uv_area / triangles.len() as f32).sqrt().max(1.0 / 1024.0);
        1.0 / (128.0 * size)
    };
    (weighted.iter())
        .map(|a| simplify::Attribute {
            weight: match a.role {
                simplify::Role::Texture => uv_weight(a.values),
                _ => a.weight,
            },
            ..*a
        })
        .collect()
}

/// Canonical vertex per position and every carried attribute, from `weld_seam`, the weld by
/// position and every texture set (the position weld without one): copies equal in every float
/// the build carries, bones included, are one vertex, as a group's children's are once merged.
/// Nothing is lost: coarse levels point at a copy identical in everything the page stores. `first`
/// is each vertex's first use in the index list (`clusters::first_uses`).
pub fn weld_exact(weld_seam: &[u32], carried: &[&Attribute], first: &[u32]) -> Vec<u32> {
    let rest: Vec<(&[f32], usize)> = (carried.iter())
        .filter(|a| !UV_FLAGS.contains(&a.flag))
        .map(|a| (&a.values[..], a.width))
        .collect();
    weld_refined(weld_seam, &rest, first)
}

/// Floats of carried values one weld pass keys beside the weld it refines.
const KEY_FLOATS: usize = 8;
/// A piece of an attribute a weld pass keys: its values and width, the first float and how many.
type Piece<'v> = (&'v [f32], usize, usize, usize);

/// `weld` refined by the floats of each of `attributes` (values, width), their bits as
/// `normalized_bits`; a vertex an attribute holds no value for keys apart from one it does. The key
/// is fixed — the canonical vertex and `KEY_FLOATS` floats —, so a wider set takes several passes,
/// each refining the last: the canonical vertex of a class is its first in the index list
/// (`first`, `weld_by`) whatever the passes, the same as one pass over the whole key. Texture
/// sets refine the position weld into the seam weld (`weld_seam`), and the other attributes the
/// seam weld into the exact one.
pub(super) fn weld_refined(
    weld: &[u32],
    attributes: &[(&[f32], usize)],
    first: &[u32],
) -> Vec<u32> {
    // Each attribute in pieces of at most `KEY_FLOATS` floats, the pieces in passes of as many.
    let pieces = (attributes.iter()).flat_map(|&(values, width)| {
        (0..width)
            .step_by(KEY_FLOATS)
            .map(move |at| (values, width, at, (width - at).min(KEY_FLOATS)))
    });
    let mut passes: Vec<Vec<Piece>> = Vec::new();
    for piece in pieces {
        match passes.last_mut() {
            Some(pass) if pass.iter().map(|p| p.3).sum::<usize>() + piece.3 <= KEY_FLOATS => {
                pass.push(piece)
            }
            _ => passes.push(vec![piece]),
        }
    }
    // No pass leaves the weld as it is; the first pass reads it in place.
    let Some((head, rest)) = passes.split_first() else {
        return weld.to_vec();
    };
    let mut refined = weld_by(first, |id| pass_key(weld, head, id));
    for pass in rest {
        refined = weld_by(first, |id| pass_key(&refined, pass, id));
    }
    refined
}

/// Vertex `id`'s key in one weld pass: its canonical vertex in `weld`, the bits of the floats of
/// `pass` it holds and which pieces it holds a value for.
fn pass_key(weld: &[u32], pass: &[Piece], id: u32) -> (u32, [u32; KEY_FLOATS], u8) {
    let (v, mut bits, mut held, mut filled) = (id as usize, [0u32; KEY_FLOATS], 0u8, 0);
    for (piece, &(values, width, at, take)) in pass.iter().enumerate() {
        if let Some(copy) = values.get(v * width..v * width + width) {
            held |= 1 << piece;
            let copy = copy[at..at + take].iter().map(|&x| normalized_bits(x));
            (bits[filled..filled + take].iter_mut())
                .zip(copy)
                .for_each(|(b, x)| *b = x);
        }
        filled += take;
    }
    (weld[v], bits, held)
}

/// The bits of a vertex's position and attributes: 3 floats, then at most a normal, a stored
/// tangent, a colour and four texture sets — 22 —, held inline; the bones of a skinned vertex
/// spill.
pub(crate) type Key = SmallVec<[u32; 22]>;

/// The bits of vertex `v`'s position and of its `width` floats of each of `attributes`: equal
/// keys, one vertex to a page.
pub(crate) fn key<'v>(
    positions: &[f32],
    v: usize,
    attributes: impl Iterator<Item = (&'v [f32], usize)>,
) -> Key {
    let mut key: Key = SmallVec::from_slice(&position_key(positions, v as u32));
    for (values, width) in attributes {
        let copy = values.get(v * width..v * width + width).unwrap_or(&[]);
        key.extend(copy.iter().map(|&x| normalized_bits(x)));
    }
    key
}
