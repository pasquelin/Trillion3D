//! The vertex attributes a reduction answers for: normals, texture sets and the colour count in
//! the simplification error, each at the weight of what it changes on screen, and each copy of a
//! position keeps its own (`qem_simplifier.rs`).
use super::clusters::{position_key, weld_by};
use crate::qem;
use smallvec::SmallVec;
use trillion3d_math::scalar::normalized_bits;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// Every attribute the pages carry beside the positions, and only those: the reduction answers
/// for what the pages draw, and a texture set no material reads never holds a group.
#[derive(Clone, Copy, Default)]
pub struct DagAttributes<'a> {
    pub carried: &'a [&'a Attribute],
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
        self.values(FLAG_UV).chain(self.values(FLAG_UV1)).collect()
    }
    /// The carried attributes the simplifier weighs, in its order — the normal, the colour, then
    /// every texture set; the pages carry no tangent — at their weight in the simplifier's frame,
    /// where the mean triangle is a quarter to a half of a unit across (`qem_solve.rs`): each
    /// normal float 1, each colour channel 1/16, a texture coordinate by the group's texture
    /// density (`group_weighted`).
    pub(crate) fn weighted(&self) -> Vec<qem::Attribute<'a>> {
        let with = |flag| self.carried.iter().copied().filter(move |a| a.flag == flag);
        let attribute = |role: qem::Role, weight: f32| {
            move |a: &'a Attribute| qem::Attribute {
                values: &a.values,
                width: a.width,
                weight,
                role,
            }
        };
        let normals = with(FLAG_NORMAL)
            .take(1)
            .map(attribute(qem::Role::Normal, 1.0));
        let colours = with(FLAG_COLOR)
            .take(1)
            .map(attribute(qem::Role::Color, 0.0625));
        let uvs = (with(FLAG_UV).chain(with(FLAG_UV1))).map(attribute(qem::Role::Texture, 1.0));
        normals.chain(colours).chain(uvs).collect()
    }
}

/// `weighted` with each texture set at its weight for one group, over the group's live
/// triangles `live`: 1 / (128 · size), `size` the mean triangle's size in texture space (the
/// square root of its mean texture area), held at 1/1024 or more.
pub(crate) fn group_weighted<'a>(
    weighted: &[qem::Attribute<'a>],
    live: &[u32],
) -> Vec<qem::Attribute<'a>> {
    let triangles = live.as_chunks::<3>().0;
    let count = triangles.len().max(1) as f64;
    let uv_size = |uvs: &[f32]| {
        let uv = |v: u32| [uvs[v as usize * 2], uvs[v as usize * 2 + 1]].map(f64::from);
        let uv_area: f64 = (triangles.iter())
            .map(|t| {
                let ([u0, v0], [u1, v1], [u2, v2]) = (uv(t[0]), uv(t[1]), uv(t[2]));
                (0.5 * ((u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0))).abs()
            })
            .sum();
        (uv_area / count).sqrt()
    };
    let uv_weight = |uvs: &[f32]| (1.0 / (128.0 * uv_size(uvs).max(1.0 / 1024.0))) as f32;
    (weighted.iter())
        .map(|a| qem::Attribute {
            weight: match a.role {
                qem::Role::Texture => uv_weight(a.values),
                _ => a.weight,
            },
            ..*a
        })
        .collect()
}

/// Canonical vertex per position and every carried attribute, from `weld_seam`, the weld by
/// position and every texture set (the position weld without one): copies a page cannot tell
/// apart are one vertex, so an unindexed mesh reduces as the indexed one it draws the same as.
/// Nothing is lost: coarse levels point at a copy identical in everything the page stores.
pub fn weld_exact(weld_seam: &[u32], carried: &[&Attribute], indices: &[u32]) -> Vec<u32> {
    let rest: Vec<(&[f32], usize)> = (carried.iter())
        .filter(|a| a.flag != FLAG_UV && a.flag != FLAG_UV1)
        .map(|a| (&a.values[..], a.width))
        .collect();
    weld_refined(weld_seam, &rest, indices)
}

/// Floats of carried values one weld pass keys beside the weld it refines.
const KEY_FLOATS: usize = 8;
/// A piece of an attribute a weld pass keys: its values and width, the first float and how many.
type Piece<'v> = (&'v [f32], usize, usize, usize);

/// `weld` refined by the floats of each of `attributes` (values, width), their bits as
/// `normalized_bits`; a vertex an attribute holds no value for keys apart from one it does. The key
/// is fixed — the canonical vertex and `KEY_FLOATS` floats —, so a wider set takes several passes,
/// each refining the last: the canonical vertex of a class is its first in `indices` whatever the
/// passes, the same as one pass over the whole key. Texture sets refine the position weld into the
/// seam weld (`weld_seam`), and the other attributes the seam weld into the exact one.
pub(super) fn weld_refined(
    weld: &[u32],
    attributes: &[(&[f32], usize)],
    indices: &[u32],
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
    let mut weld = weld.to_vec();
    for pass in passes {
        weld = weld_by(weld.len(), indices, |id| {
            let (v, mut bits, mut held, mut filled) = (id as usize, [0u32; KEY_FLOATS], 0u8, 0);
            for (piece, &(values, width, at, take)) in pass.iter().enumerate() {
                if let Some(copy) = values.get(v * width..v * width + width) {
                    held |= 1 << piece;
                    let copy = copy[at..at + take].iter().map(|&x| normalized_bits(x));
                    bits[filled..filled + take]
                        .iter_mut()
                        .zip(copy)
                        .for_each(|(b, x)| *b = x);
                }
                filled += take;
            }
            (weld[v], bits, held)
        });
    }
    weld
}

/// The bits of a vertex's position and attributes: 3 floats, then at most a normal, a colour and
/// two texture sets — 14 —, held inline.
pub(super) type Key = SmallVec<[u32; 16]>;

/// The bits of vertex `v`'s position and of its `width` floats of each of `attributes`: equal
/// keys, one vertex to a page.
pub(super) fn key<'v>(
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
