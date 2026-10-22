//! The source covers placed in world space for the world's HLOD builds (`builds.rs`) — the
//! original objects every level approximates, merges, voxelizes and bakes —, each component read
//! through its transform, since one shell is built over objects placed apart: positions by
//! the object's matrix, normals by its linear part with the scale taken out (`Normals`: the way
//! the layer's builder takes it out), texture sets as they are, colour four-wide, in the one
//! layout a world page is written in. A mirrored object's
//! triangles turn back to the front: a world page is drawn under the identity.
use super::*;
use crate::proxy::placement::place;
use trillion3d_math::matrix::linear::{determinant, linear_columns};
use trillion3d_math::vector::vec3::{cross, unit, unit_or_itself};
use trillion3d_math::vector::vecn::scale;
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

/// How a placed object's matrix turns its normals, the two ways its layer's builder takes the scale
/// out of it: by its axes (columns) each brought to length 1 (`Axes`, the merge's), or by the
/// transposed adjoint of its linear part, each row brought to length 1 and the whole turned about
/// when the matrix mirrors (`Adjoint`, the simplifier's). A rotation, a stretch along the
/// object's own axes and a mirror give the same normals either way; a shear alone parts them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Normals {
    Axes,
    Adjoint,
}

/// The three vectors the components of a normal weigh under `matrix`, as `rule` takes them: an axis
/// or a row of no length left as it is.
fn normal_rows(matrix: &Mat4, rule: Normals) -> [[f64; 3]; 3] {
    let axes = linear_columns(matrix);
    match rule {
        Normals::Axes => axes.map(unit_or_itself),
        Normals::Adjoint => {
            let turn = if determinant(matrix) < 0.0 { -1.0 } else { 1.0 };
            let rows = [
                cross(axes[1], axes[2]),
                cross(axes[2], axes[0]),
                cross(axes[0], axes[1]),
            ];
            rows.map(|row| scale(unit_or_itself(row), turn))
        }
    }
}

/// `cover`'s attributes on its vertices placed by `matrix` (`conform`'s order): normals turned by
/// its linear part with the scale taken out as `normals` says (`normal_rows`), so a stretch tilts
/// none and a mirror reflects it; colours four-wide, the others as they are.
fn place_attributes(cover: &SourceCover, matrix: &Mat4, normals: Normals) -> Vec<Attribute> {
    let vertices = cover.positions.len() / 3;
    let rows = normal_rows(matrix, normals);
    let placed = (cover.carried.iter())
        .map(|source| {
            let w = source.width;
            let values = &source.values[..vertices * w];
            let values = match source.flag {
                FLAG_NORMAL => (values.chunks_exact(w))
                    .flat_map(|value| {
                        let n = [0, 1, 2].map(|a| f64::from(value[a]));
                        let turned = [0, 1, 2]
                            .map(|r| rows[0][r] * n[0] + rows[1][r] * n[1] + rows[2][r] * n[2]);
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

/// The object `placed` in world space: its positions, the attributes of its cover on them, its
/// normals turned as `normals` says, and its triangles, turned back when its matrix mirrors.
pub(crate) fn gather(placed: &Instance, normals: Normals) -> (Vec<f32>, Vec<Attribute>, Vec<u32>) {
    let mut positions = Vec::new();
    let mirrored = determinant(&placed.matrix) < 0.0;
    place(&placed.cover.positions, &placed.matrix, &mut positions);
    let carried = place_attributes(placed.cover, &placed.matrix, normals);
    let indices = (placed.cover.indices.as_chunks::<3>().0.iter())
        .flat_map(|&[a, b, c]| if mirrored { [a, c, b] } else { [a, b, c] })
        .collect();
    (positions, carried, indices)
}

/// The objects `members` of `instances` placed in world space (`gather`, normals by their axes:
/// `Normals::Axes`), each with its material.
pub(crate) fn objects(
    instances: &[Instance],
    members: &[usize],
) -> Vec<crate::hlod::flatten::Object> {
    (members.iter())
        .map(|&i| (instances[i].material, gather(&instances[i], Normals::Axes)))
        .collect()
}

/// The triangles the objects `members` of `instances` hold at level 0.
pub(crate) fn triangles(instances: &[Instance], members: &[usize]) -> usize {
    (members.iter())
        .map(|&i| instances[i].cover.indices.len() / 3)
        .sum()
}
