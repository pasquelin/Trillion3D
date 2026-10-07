//! The object roots placed in world space for the world builds (`merge.rs`): one level-0 cluster
//! per placed object — every root cluster of its cover, the largest error, a sphere holding each
//! root's —, so the world DAG stands in for an object whole or not at all. With them, the
//! attributes their pages carry, in one layout a world page is written in: normals by the inverse
//! transpose of the object's matrix, texture sets as they are, colour four-wide. A mirrored
//! object's triangles turn back to the front: a world page is drawn under the identity.
use super::*;
use crate::compiler_world::{cofactor_direction, transform_point};
use crate::geometry_page::{Attribute, FLAG_COLOR, FLAG_NORMAL};
use crate::proxy::{place, world_scale};
use crate::shared_math::{cross, dot, linear_columns, unit};

/// The attributes a world vertex may carry, in the order a page writes them, at the width a world
/// page stores each: the page format's own.
pub(super) use trillion3d_page_codec::OPTIONAL as LAYOUT;

/// Root clusters as the builder takes them: triangles, and the error and sphere each was
/// published at.
pub(super) type Roots = Vec<(Vec<u32>, f64, [f64; 4])>;

/// The layout `cover` carries: the flags of the attributes its pages carry.
pub(super) fn layout_of(cover: &RootCover) -> u32 {
    cover.carried.iter().fold(0, |flags, a| flags | a.flag)
}

/// The attributes of `layout`, empty, in `LAYOUT` order.
pub(super) fn empty(layout: u32) -> Vec<Attribute> {
    LAYOUT
        .iter()
        .filter(|(flag, _)| layout & flag != 0)
        .map(|&(flag, width)| Attribute {
            flag,
            width,
            values: Vec::new(),
        })
        .collect()
}

/// The sphere holding every one of `spheres`, centred on their box.
fn holding(spheres: &[[f64; 4]]) -> [f64; 4] {
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for s in spheres {
        for a in 0..3 {
            low[a] = low[a].min(s[a] - s[3]);
            high[a] = high[a].max(s[a] + s[3]);
        }
    }
    let centre = [0, 1, 2].map(|a| (low[a] + high[a]) * 0.5);
    let reach = |s: &[f64; 4]| {
        let d = [0, 1, 2].map(|a| s[a] - centre[a]);
        dot(d, d).sqrt() + s[3]
    };
    let radius = spheres.iter().map(reach).fold(0.0, f64::max);
    [centre[0], centre[1], centre[2], radius]
}

/// `cover`'s attributes on its vertices placed by `matrix`, appended to `out` (`empty`'s order).
fn place_attributes(cover: &RootCover, matrix: &Mat4, mirrored: bool, out: &mut [Attribute]) {
    let vertices = cover.positions.len() / 3;
    for target in out.iter_mut() {
        let Some(source) = cover.carried.iter().find(|a| a.flag == target.flag) else {
            target
                .values
                .resize(target.values.len() + vertices * target.width, 0.0);
            continue;
        };
        let w = source.width;
        for v in 0..vertices {
            let value = &source.values[v * w..v * w + w];
            match target.flag {
                FLAG_NORMAL => {
                    let n = [0, 1, 2].map(|a| f64::from(value[a]));
                    let turned =
                        cofactor_direction(matrix, n).map(|x| if mirrored { -x } else { x });
                    let n = unit(turned).unwrap_or(n);
                    target.values.extend(n.map(|x| x as f32));
                }
                FLAG_COLOR => {
                    target.values.extend_from_slice(value);
                    target.values.extend(std::iter::repeat_n(1.0, 4 - w));
                }
                _ => target.values.extend_from_slice(value),
            }
        }
    }
}

/// The objects of `members` placed in world space, one level-0 cluster each, with the attributes
/// of `layout` on their vertices; and the instance each cluster comes from.
pub(super) fn gather(
    instances: &[Instance],
    members: &[usize],
    layout: u32,
) -> (Vec<f32>, Vec<Attribute>, Roots, Vec<usize>) {
    let (mut positions, mut carried) = (Vec::new(), empty(layout));
    let (mut roots, mut origins) = (Vec::new(), Vec::new());
    for &instance in members {
        let placed = &instances[instance];
        let base = (positions.len() / 3) as u32;
        let [a0, a1, a2] = linear_columns(&placed.matrix);
        let mirrored = dot(a0, cross(a1, a2)) < 0.0;
        place(&placed.cover.positions, &placed.matrix, &mut positions);
        place_attributes(placed.cover, &placed.matrix, mirrored, &mut carried);
        let scale = world_scale(&placed.matrix);
        let (mut indices, mut error, mut spheres) = (Vec::new(), 0.0f64, Vec::new());
        for root in &placed.cover.clusters {
            for &[a, b, c] in root.indices.as_chunks::<3>().0 {
                let corners = if mirrored { [a, c, b] } else { [a, b, c] };
                indices.extend(corners.map(|v| v + base));
            }
            error = error.max(root.error * scale);
            let [x, y, z, radius] = root.sphere;
            let [x, y, z] = transform_point(&placed.matrix, [x, y, z]);
            spheres.push([x, y, z, radius * scale]);
        }
        roots.push((indices, error, holding(&spheres)));
        origins.push(instance);
    }
    (positions, carried, roots, origins)
}
