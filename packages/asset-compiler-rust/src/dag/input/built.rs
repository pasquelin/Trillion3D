//! Step 1 of the build's input (`input.rs`): every vertex as a mesh build lays it, before any
//! weld.
//!
//! **As read.** A colour's red, green and blue are first brought from sRGB to linear
//! (`srgb_to_linear_f32`), as a mesh's reader counters the sRGB encoding its build applies. Then a
//! position that is not finite on every axis is the origin; a normal or a stored tangent's
//! direction that is not finite is nothing, the tangent's sign 0 when it is not a number; a
//! texture coordinate pair that is not finite is (0, 0) and a colour that is not finite white. A
//! triangle two of whose corners are one vertex is no triangle.
//!
//! **Rebuilt.** The normals and the stored tangents are rebuilt from the triangles around them as
//! the mesh's rules name it (`frames.rs`, `FrameRules::of`). A skinned mesh whose pages store no
//! tangent still has its build's: a tangent, nothing at first, is rebuilt beside its normal and
//! read by the weld alone (`Built::tangents`).
//!
//! **Laid.** Each vertex's bitangent is its tangent's direction across its normal, times its sign;
//! the bitangent, the normal and the tangent's direction are made unit — each only when its
//! squared length exceeds `UNIT_SQUARED` —, and the sign is 1 unless the unit normal across the
//! unit tangent and the bitangent point apart, −1 then: a tangent along its normal signs 1. Each
//! colour channel becomes the byte its sRGB encoding rounds to, its alpha the byte of its linear
//! value (`colour.rs`), as a share of 255. The bones are kept as they are.
use super::colour::{alpha_byte, srgb_byte};
use super::frames::{self, FrameRules};
use super::{finite, InputRules};
use crate::dag::DagAttributes;
use crate::simplify::unit_or_same;
use trillion3d_math::color::srgb_to_linear_f32;
use trillion3d_math::scalar::byte_to_unit_f32;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, scale};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_SKIN, FLAG_TANGENT, UV_MASK};

/// The source's vertices as built: their positions, every carried attribute in the source's order
/// and layout, and, when they have a normal and a tangent, each one's bitangent, and the tangent's
/// direction when the pages store none (a skinned mesh's), which only the weld reads (`weld.rs`);
/// the source's triangles as read, three distinct vertices each; and, per vertex past the
/// source's — one more piece of a vertex whose frame was rebuilt in pieces (`frames.rs`), or a
/// vertex a skinned weld laid twice (`skinned.rs`) —, the source vertex it copies; and, per
/// triangle read, its rank among the source's triangles (`source`).
pub(in crate::dag) struct Built {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub bitangents: Vec<[f32; 3]>,
    pub tangents: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
    pub source: Vec<u32>,
    pub origin: Vec<u32>,
}

/// The vertices of `positions` and `attributes`, under the triangles `indices`, as built by
/// `rules` (the module's rule).
pub(in crate::dag) fn built(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    rules: &InputRules,
) -> Built {
    let mut positions: Vec<f32> = (positions.as_chunks::<3>().0.iter())
        .flat_map(|&p| if finite(&p) { p } else { [0.0; 3] })
        .collect();
    let mut carried: Vec<Attribute> = attributes.carried.iter().map(|&a| a.clone()).collect();
    for a in &mut carried {
        let flag = a.flag;
        for v in a.values.chunks_exact_mut(a.width) {
            match flag {
                FLAG_NORMAL if !finite(v) => v.fill(0.0),
                FLAG_TANGENT => {
                    if !finite(&v[..3]) {
                        v[..3].fill(0.0);
                    }
                    if v[3].is_nan() {
                        v[3] = 0.0;
                    }
                }
                flag if flag & UV_MASK != 0 && !finite(v) => v.fill(0.0),
                FLAG_COLOR => {
                    v[..3].iter_mut().for_each(|c| *c = srgb_to_linear_f32(*c));
                    if !finite(v) {
                        v.fill(1.0);
                    }
                }
                _ => {}
            }
        }
    }
    // The triangles two of whose corners are one vertex dropped, each kept one's source rank noted.
    let (mut kept, mut source) = (Vec::with_capacity(indices.len()), Vec::new());
    for (rank, &[a, b, c]) in indices.as_chunks::<3>().0.iter().enumerate() {
        if a != b && b != c && a != c {
            kept.extend([a, b, c]);
            source.push(rank as u32);
        }
    }
    let mut indices = kept;
    let mut origin = Vec::new();
    let has = |carried: &[Attribute], flag| carried.iter().any(|a| a.flag == flag);
    let skinned = has(&carried, FLAG_SKIN);
    let weld_only = skinned && has(&carried, FLAG_NORMAL) && !has(&carried, FLAG_TANGENT);
    if weld_only {
        let values = vec![0.0; positions.len() / 3 * 4];
        carried.push(Attribute {
            flag: FLAG_TANGENT,
            width: 4,
            values,
        });
    }
    let rules = FrameRules::of(rules, skinned);
    frames::rebuild(
        &mut positions,
        &mut carried,
        &mut indices,
        &mut origin,
        rules,
    );
    let of = |flag| carried.iter().find(|a| a.flag == flag);
    let bitangents = match (of(FLAG_NORMAL), of(FLAG_TANGENT)) {
        (Some(normals), Some(tangents)) => (normals.values.as_chunks::<3>().0.iter())
            .zip(tangents.values.as_chunks::<4>().0)
            .map(|(&n, t)| unit_or_same(scale(cross([t[0], t[1], t[2]], n), t[3])))
            .collect(),
        _ => Vec::new(),
    };
    for a in &mut carried {
        match a.flag {
            FLAG_NORMAL => (a.values.as_chunks_mut::<3>().0.iter_mut()).for_each(|n| {
                *n = unit_or_same(*n);
            }),
            FLAG_TANGENT => (a.values.as_chunks_mut::<4>().0.iter_mut()).for_each(|t| {
                let direction = unit_or_same([t[0], t[1], t[2]]);
                t[..3].copy_from_slice(&direction);
            }),
            FLAG_COLOR => (a.values.chunks_exact_mut(a.width)).for_each(|colour| {
                for (channel, value) in colour.iter_mut().enumerate() {
                    let byte = if channel < 3 {
                        srgb_byte(*value)
                    } else {
                        alpha_byte(*value)
                    };
                    *value = byte_to_unit_f32(byte);
                }
            }),
            _ => {}
        }
    }
    signed(&mut carried, &bitangents);
    // The weld's own tangents, which the pages do not store.
    let tangents: Vec<[f32; 3]> = match weld_only {
        true => carried.pop().map_or_else(Vec::new, |t| {
            (t.values.as_chunks::<4>().0.iter())
                .map(|&[x, y, z, _]| [x, y, z])
                .collect()
        }),
        false => Vec::new(),
    };
    Built {
        positions,
        carried,
        bitangents,
        tangents,
        indices,
        source,
        origin,
    }
}

/// Every stored tangent's sign as the build lays it from the unit frame (the module's rule): 1
/// unless the unit tangent across the unit normal points away from the bitangent.
fn signed(carried: &mut [Attribute], bitangents: &[[f32; 3]]) {
    let normal = carried.iter().position(|a| a.flag == FLAG_NORMAL);
    let tangent = carried.iter().position(|a| a.flag == FLAG_TANGENT);
    let (Some(normal), Some(tangent)) = (normal, tangent) else {
        return;
    };
    let [normals, tangents] = carried
        .get_disjoint_mut([normal, tangent])
        .expect("the normal and the tangent are two attributes");
    let tangents = tangents.values.as_chunks_mut::<4>().0;
    for ((t, n), b) in tangents
        .iter_mut()
        .zip(normals.values.as_chunks::<3>().0)
        .zip(bitangents)
    {
        let across = cross([t[0], t[1], t[2]], *n);
        t[3] = if dot(across, *b) < 0.0 { -1.0 } else { 1.0 };
    }
}
