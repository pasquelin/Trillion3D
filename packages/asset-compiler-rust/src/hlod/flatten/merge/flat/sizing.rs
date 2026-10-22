//! What a merged actor measures before it is made: its atlas's sides (`atlas_sides`) from the
//! merged mesh's area (`area`) and its sources' bounding sphere (`sphere`), and the vertices and
//! corners its sources' cut holds (`cut_counts`), which its working bytes follow (`working.rs`).
//! The sphere is also the one an approximated actor's captures frame (`bake::capture`); a
//! simplified actor sizes its atlas the same way.
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::chain::Instance;
use crate::hlod::flatten::merge::{Cut, MeshBounds, Part};
use crate::hlod::flatten::{screen_size, Sides, SCREEN};
use crate::hlod::options::{HlodAtlasSizing, HlodBiasFloors, HlodMapSides, HlodTextureSizing};
use std::collections::BTreeMap;
use trillion3d_math::geometry::aabb::{aabb_of_boxes, centre};
use trillion3d_math::geometry::box_transform::box_transform;
use trillion3d_math::geometry::sphere::farthest;
use trillion3d_math::geometry::triangle::triangle_area;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{length, squared_length, sub};

/// An atlas side: `given` when its sizing is fixed, else the power of two, 16 to 8192 texels,
/// whose texel density over the mesh lies nearest the density the sizing asks for: a fixed count
/// of texels a metre, or the texels a metre the mesh's bounding sphere of `radius` metres spans
/// across a view of 1920 texels, at a fixed share of that view or where the actor is first drawn,
/// `distance` metres away (`flatten::screen_size`). The mesh's texels a metre per texel of side
/// are `ratio`: the square root of the share of the square its coordinates cover over its area —
/// the inverse of its area's root where they fill it, a merged or simplified mesh's, an
/// approximated shell's charts covering less (`flatten::layers`).
fn side_at_ratio(
    sizing: HlodTextureSizing,
    given: usize,
    (ratio, radius, distance): (f64, f64, f64),
) -> usize {
    let across = |screen: f64| screen * SCREEN.0 / (2.0 * radius);
    let density = match sizing {
        HlodTextureSizing::Fixed => return given,
        HlodTextureSizing::TexelDensity(texels) => texels,
        HlodTextureSizing::ScreenSize(screen) => across(screen),
        HlodTextureSizing::DrawDistance => across(screen_size(radius, distance)),
    };
    // Past twice the largest side, the side is the largest.
    let largest = 2.0 * crate::MAX_HLOD_TEXTURE_SIZE as f64;
    let perfect = (density / ratio).ceil().clamp(0.0, largest) as u32;
    let high = perfect.next_power_of_two();
    let low = high >> 1;
    let below = density - f64::from(low) * ratio;
    let above = f64::from(high) * ratio - density;
    let best = if below < above { low } else { high } as usize;
    best.clamp(crate::MIN_HLOD_TEXTURE_SIZE, crate::MAX_HLOD_TEXTURE_SIZE)
}

/// The side an atlas of a layer whose `textureSize` is `given` is baked at, and each image's own,
/// as the layer's sizing gives them (`HlodAtlasSizing`): one side for every image — `given`, or
/// the power of two a density asks for, `reach` the mesh's texels a metre per texel of side, its
/// bounding sphere's radius and the distance its actor is first drawn from (`side_at_ratio`), read
/// only then —; or each image its own, `own` bringing the sides a manual sizing names, or
/// `floors` biased from `given` (`HlodMapSides::biased`), to the side the atlas is baked at and the
/// images' (an approximated, a merged and a simplified layer's differ in which maps it counts).
/// An approximated, a merged and a simplified layer size alike.
pub(in crate::hlod) fn atlas_sides(
    (sizing, given): (HlodAtlasSizing, usize),
    reach: impl Fn() -> (f64, f64, f64),
    (floors, own): (HlodBiasFloors, impl Fn(&HlodMapSides) -> (usize, Sides)),
) -> (usize, Sides) {
    match sizing {
        HlodAtlasSizing::Uniform(HlodTextureSizing::Fixed) => (given, Sides::uniform(given)),
        HlodAtlasSizing::Uniform(sizing) => {
            let side = side_at_ratio(sizing, given, reach());
            (side, Sides::uniform(side))
        }
        HlodAtlasSizing::Biased => own(&HlodMapSides::biased(given, floors)),
        HlodAtlasSizing::Manual(maps) => own(&maps),
    }
}

/// The area of `parts`' triangles in world space, square metres.
pub(in crate::hlod) fn area(parts: &[Part]) -> f64 {
    (parts.iter())
        .map(|part| {
            let (positions, _, indices) = &part.geometry;
            (indices.as_chunks::<3>().0.iter())
                .map(|t| {
                    let [a, b, c] = t.map(|v| point(positions, v));
                    triangle_area(a, b, c)
                })
                .sum::<f64>()
        })
        .sum()
}

/// The bounding sphere of sources `placed`, each its mesh bounds and its matrix, its centre and
/// radius in metres: each one's bounds placed by its matrix — its box transformed, its sphere
/// scaled by the matrix's longest row but no wider than that box's half diagonal —, gathered in
/// order, each step's box the union of both and its sphere about that box's centre, the smaller of
/// the box's half diagonal and the farthest reach of the two spheres; the centre the last box's.
pub(in crate::hlod) fn sphere<'a>(
    placed: impl Iterator<Item = (MeshBounds, &'a Mat4)>,
) -> ([f64; 3], f64) {
    let placed = placed.map(|(bounds, matrix)| {
        let mut flat = [0.0; 6];
        let mesh = [bounds.low, bounds.high].concat();
        box_transform(&mut flat, &mesh, matrix);
        let (low, high) = ([flat[0], flat[1], flat[2]], [flat[3], flat[4], flat[5]]);
        // The squared length of a row of the matrix: one coordinate's weights over the three axes.
        let axis = |row: usize| squared_length([0, 1, 2].map(|k| matrix[k * 4 + row]));
        let largest = axis(0).max(axis(1)).max(axis(2)).sqrt();
        let half = 0.5 * length(sub(high, low));
        (low, high, (largest * bounds.radius).min(half))
    });
    let gathered = placed.reduce(|(low_a, high_a, radius_a), (low_b, high_b, radius_b)| {
        let (low, high) = aabb_of_boxes([(low_a, high_a), (low_b, high_b)]);
        let middle = centre(low, high);
        let reach = farthest(
            middle,
            [
                (centre(low_a, high_a), radius_a),
                (centre(low_b, high_b), radius_b),
            ],
        );
        (low, high, (0.5 * length(sub(high, low))).min(reach))
    });
    gathered.map_or(([0.0; 3], 0.0), |(low, high, radius)| {
        (centre(low, high), radius)
    })
}

/// The vertices and corners the sources `members` of `instances` hold at the LOD `cut` takes — their
/// level 0 with none —, each placed copy counted; what a source holds is counted once, whatever
/// its copies.
pub(in crate::hlod) fn cut_counts(
    instances: &[Instance],
    members: &[usize],
    cut: Option<Cut>,
) -> (usize, usize) {
    let mut sources: BTreeMap<usize, (usize, usize)> = BTreeMap::new();
    (members.iter()).fold((0, 0), |(vertices, corners), &i| {
        let instance = &instances[i];
        let (held, taken) = *sources.entry(instance.source()).or_insert_with(|| {
            let cover = instance.cover;
            match cut {
                Some(cut) => cover.lods.cut_counts(cut),
                None => (cover.positions.len() / 3, cover.indices.len()),
            }
        });
        (vertices + held, corners + taken)
    })
}
