//! What a merged actor measures before it is made: its atlas's sides (`atlas_sides`) from the
//! merged mesh's area (`area`) and its sources' bounding sphere (`sphere`), and the bytes its
//! sources' cut holds (`cut_bytes`) and its making holds (`working_bytes`). The sphere is also the
//! one an approximated actor's captures frame (`bake::capture`); a simplified actor sizes its
//! atlas the same way.
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::chain::Instance;
use crate::hlod::flatten::merge::{mesh_bytes, Cut, MeshBounds, Part};
use crate::hlod::flatten::{screen_size, Sides, SCREEN, SOURCE_TRIANGLE_BYTES};
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
/// scaled by the matrix's largest axis but no wider than that box's half diagonal —, gathered in
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
        // Each axis's image, a column of the matrix.
        let axis = |k: usize| squared_length([0, 1, 2].map(|row| matrix[k * 4 + row]));
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

/// The bytes and corners the sources `members` of `instances` hold at the LOD `cut` takes — their
/// level 0 with none —, each placed copy counted; what a source holds is measured once, whatever
/// its copies.
pub(in crate::hlod) fn cut_bytes(
    instances: &[Instance],
    members: &[usize],
    cut: Option<Cut>,
) -> (usize, usize) {
    let mut sources: BTreeMap<usize, (usize, usize)> = BTreeMap::new();
    (members.iter()).fold((0, 0), |(bytes, corners), &i| {
        let instance = &instances[i];
        let (held, taken) = *sources.entry(instance.source()).or_insert_with(|| {
            let cover = instance.cover;
            match cut {
                Some(cut) => {
                    let taken: usize = cover.lods.selected(cut).map(<[u32]>::len).sum();
                    (cover.lods.cut_bytes(cut), taken)
                }
                None => {
                    let taken = cover.indices.len();
                    (mesh_bytes(cover.positions.len() / 3, taken), taken)
                }
            }
        });
        (bytes + held, corners + taken)
    })
}

/// The bytes an atlas texel of a merged actor holds while it is made: its entry's bake at the
/// atlas's side — the triangle covering it and its weights (24), the three images as baked and
/// as kept (24), a resize's filtered rows (32) — and the atlas's three images (12), with the
/// filling's marks and rings (18).
const MERGED_TEXEL_BYTES: usize = 24 + 24 + 32 + 12 + 18;

/// The bytes an atlas texel of a merged actor holds beside `MERGED_TEXEL_BYTES` while it bakes the
/// emission, the occlusion or the anisotropy (`Maps::has_more`): what its entry's second pass
/// reads of the texel (24), its three images as baked and as kept (12), and the atlas's (12).
const MORE_TEXEL_BYTES: usize = 24 + 12 + 12;

/// The bytes a triangle of a merged actor holds while its translucent parts are read behind
/// (`tile::Behind`): its traced copy — corners, material, coordinates, normals and colours (≈ 180)
/// — and its share of the tree over them — its corners again, its rank, the nodes (≈ 60).
const BEHIND_TRIANGLE_BYTES: usize = 240;

/// The bytes a merged actor holds while it is made from pieces of `bytes` and `corners`: each
/// piece, its placed copy and its section's copy; each triangle's DAG build or, when its materials
/// are merged into a `side` atlas cooked for `families` block families, baking more maps than
/// the first pass reads where `more` (`flattened`), its mesh's coordinates and its traced copy
/// (`flatten::SOURCE_TRIANGLE_BYTES`) and what its translucent parts read behind them
/// (`BEHIND_TRIANGLE_BYTES`), and the atlas made (`MERGED_TEXEL_BYTES`, `MORE_TEXEL_BYTES`) and
/// cooked (`texture::admission::cook_bytes`, thrice).
pub(in crate::hlod) fn working_bytes(
    (bytes, corners): (usize, usize),
    flattened: Option<(usize, usize, bool)>,
) -> usize {
    let held = (bytes.saturating_mul(3))
        .saturating_add((corners / 3).saturating_mul(SOURCE_TRIANGLE_BYTES));
    match flattened {
        None => held,
        Some((side, families, more)) => {
            let cooked = crate::texture::admission::cook_bytes(side as u32, families);
            let behind = (corners / 3).saturating_mul(BEHIND_TRIANGLE_BYTES);
            let texel = MERGED_TEXEL_BYTES + if more { MORE_TEXEL_BYTES } else { 0 };
            (held.saturating_add(behind))
                .saturating_add((side * side).saturating_mul(texel))
                .saturating_add(cooked.saturating_mul(3))
        }
    }
}
