//! The source covers placed in world space for the world's HLOD builds (`builds.rs`) — the
//! original objects every level approximates, merges, voxelizes and bakes —, each component read
//! through its transform, since one shell is built over objects placed apart: positions by
//! the object's matrix, normals by its inverse transpose, texture sets as they are, colour
//! four-wide, in the one layout a world page is written in. A mirrored object's triangles turn back
//! to the front: a world page is drawn under the identity.
use super::*;
use crate::proxy::placement::place;
use trillion3d_math::matrix::linear::{cofactor_direction, determinant};
use trillion3d_math::vector::vec3::unit;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, OPTIONAL};

/// The layout `cover` carries: the flags of the attributes its pages carry.
pub(crate) fn layout_of(cover: &SourceCover) -> u32 {
    cover.carried.iter().fold(0, |flags, a| flags | a.flag)
}

/// The attributes of `layout`, empty, in `OPTIONAL` order: the attributes a world vertex may
/// carry, in the order and at the width a page writes them.
pub(crate) fn empty(layout: u32) -> Vec<Attribute> {
    OPTIONAL
        .iter()
        .filter(|(flag, _)| layout & flag != 0)
        .map(|&(flag, width)| Attribute {
            flag,
            width,
            values: Vec::new(),
        })
        .collect()
}

/// `carried` on `vertices` laid out as `layout` lays a world vertex out (`empty`'s order, each at
/// its width there): each attribute `carried` holds moved in, zeros for one it lacks — white for a
/// colour, a vertex that tints nothing —, the others dropped.
pub(super) fn conform(mut carried: Vec<Attribute>, layout: u32, vertices: usize) -> Vec<Attribute> {
    (empty(layout).into_iter())
        .map(|mut target| {
            let lacking = if target.flag == FLAG_COLOR { 1.0 } else { 0.0 };
            target.values = match carried.iter().position(|a| a.flag == target.flag) {
                Some(at) => std::mem::take(&mut carried[at].values),
                None => vec![lacking; vertices * target.width],
            };
            target
        })
        .collect()
}

/// `cover`'s attributes on its vertices placed by `matrix` (`conform`'s order): normals turned by
/// its cofactor — back to the front when it mirrors —, colours four-wide, the others as they are.
fn place_attributes(cover: &SourceCover, matrix: &Mat4, mirrored: bool) -> Vec<Attribute> {
    let vertices = cover.positions.len() / 3;
    let placed = (cover.carried.iter())
        .map(|source| {
            let w = source.width;
            let values = &source.values[..vertices * w];
            let values = match source.flag {
                FLAG_NORMAL => (values.chunks_exact(w))
                    .flat_map(|value| {
                        let n = [0, 1, 2].map(|a| f64::from(value[a]));
                        let turned =
                            cofactor_direction(matrix, n).map(|x| if mirrored { -x } else { x });
                        unit(turned).unwrap_or(n).map(|x| x as f32)
                    })
                    .collect(),
                FLAG_COLOR => (values.chunks_exact(w))
                    .flat_map(|value| value.iter().copied().chain(std::iter::repeat_n(1.0, 4 - w)))
                    .collect(),
                _ => values.to_vec(),
            };
            Attribute {
                flag: source.flag,
                width: w,
                values,
            }
        })
        .collect();
    conform(placed, layout_of(cover), vertices)
}

/// The object `placed` in world space: its positions, the attributes of its cover on them, and
/// its triangles, turned back when its matrix mirrors.
pub(crate) fn gather(placed: &Instance) -> (Vec<f32>, Vec<Attribute>, Vec<u32>) {
    let mut positions = Vec::new();
    let mirrored = determinant(&placed.matrix) < 0.0;
    place(&placed.cover.positions, &placed.matrix, &mut positions);
    let carried = place_attributes(placed.cover, &placed.matrix, mirrored);
    let indices = (placed.cover.indices.as_chunks::<3>().0.iter())
        .flat_map(|&[a, b, c]| if mirrored { [a, c, b] } else { [a, b, c] })
        .collect();
    (positions, carried, indices)
}

/// The objects `members` of `instances` placed in world space (`gather`), each with its material.
pub(crate) fn objects(
    instances: &[Instance],
    members: &[usize],
) -> Vec<crate::hlod::flatten::Object> {
    (members.iter())
        .map(|&i| (instances[i].material, gather(&instances[i])))
        .collect()
}

/// The triangles the objects `members` of `instances` hold at level 0.
pub(crate) fn triangles(instances: &[Instance], members: &[usize]) -> usize {
    (members.iter())
        .map(|&i| instances[i].cover.indices.len() / 3)
        .sum()
}
