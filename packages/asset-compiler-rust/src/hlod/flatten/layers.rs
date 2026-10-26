//! The unique meshes and the approximated and baked layers.
use super::merge::{self, MeshBounds};
use super::{
    approximate, bake, bake::sources, bake::tree, first_seen, layer_settings, pieces, step, timed,
    uv::charts, uv::pack, uv::unwrap, uv::Topology, Built, Flat, Library, Made, Object, Placements,
    Sides, StageMs, Stages,
};
use crate::hlod::options::{
    HlodApproximation, HlodAtlasSizing, HlodMapSides, HlodPatches, HlodUvMethod,
    APPROXIMATION_FLOORS,
};
use crate::HlodLayer;
use trillion3d_math::geometry::triangle::triangle_area;
use trillion3d_math::vector::vec3::point;

/// The patches unwrap every merged mesh baked on its own triangles takes, whatever its layer: a
/// hundred initial patches, the normal's turn weighed once, islands merged up to a mean squared
/// area distortion of 1.5 and a normal deviation of 45° — a merged layer sets none of them.
const MERGE_PATCHES: HlodPatches = HlodPatches {
    initial: 100,
    curvature_alignment: 1.0,
    merging_threshold: 1.5,
    max_angle_deviation: 45.0,
};

/// The most stretch the `uvAtlas` charts of a merged mesh may reach: what the unwrap the merge
/// drives is given by default, on the library's scale from 0 (none) to 1 (any).
const MERGE_STRETCH: f32 = 0.11;

/// How a mesh's texture coordinates are generated: the method, the patches unwrap's settings and
/// the `uvAtlas` charts' stretch bound.
struct UvSettings<'a> {
    method: HlodUvMethod,
    patches: &'a HlodPatches,
    stretch: f32,
}

/// `topology` cut and flattened as the settings' `method` names: into charts, cut and packed
/// (`uv::charts`), a triangle set aside held by none and left at the origin; into patches unwrapped
/// at the settings' `patches`, packed as that unwrap packs them (`uv::unwrap`) — as its maps made
/// them where the packer finds no layout —, which is also what a `legacy` mesh takes where the old
/// layout finds none (`merge::flat::laid_out`); or into the spectral charts packed for an atlas,
/// their stretch kept under the settings' `stretch` (`unwrap::atlas`), none where they fail. Per
/// corner in triangle order its coordinates, the islands as lists of triangles, and whether an
/// island holds each triangle.
fn laid(topology: &Topology, settings: &UvSettings) -> Option<unwrap::Unwrapped> {
    match settings.method {
        HlodUvMethod::Patches | HlodUvMethod::Legacy => {
            Some(unwrap::unwrap(topology, settings.patches))
        }
        HlodUvMethod::UvAtlas => unwrap::atlas(topology, settings.stretch),
        HlodUvMethod::Charts => {
            let (corners, islands) = charts::charts(topology);
            let held = (corners.as_chunks::<3>().0.iter())
                .map(|corners| corners.iter().any(|&uv| uv != [0.0; 2]))
                .collect();
            Some(unwrap::Unwrapped {
                corners,
                islands,
                held,
            })
        }
    }
}

/// Unique texture coordinates in the square of a `texture_size` atlas for an approximated shell's
/// `topology`, one per corner in triangle order: cut by `how` (`laid`) — a box projection where
/// the spectral charts fail (`unwrap::boxed`) —, then packed onto a grid of the atlas's compressed
/// blocks, a packing texel one block: each chart lands on whole blocks, its dilation keeping a
/// block between two, so no block holds two charts and its endpoints serve one. A packing that
/// finds no layout leaves the coordinates as they were (`pack::pack`).
fn unwrapped_by(topology: &Topology, texture_size: usize, how: &UvSettings) -> Vec<[f64; 2]> {
    let mut unwrapped = laid(topology, how).unwrap_or_else(|| unwrap::boxed(topology));
    let blocks = texture_size as u32 / crate::plugins::image::blocks::BLOCK_SIDE;
    pack::pack(&mut unwrapped.corners, &unwrapped.islands, blocks);
    unwrapped.corners
}

/// Unique texture coordinates in the unit square for the mesh of `points` welded and `triangles`
/// over them, one per corner in triangle order, and whether the unwrap's mesh holds each triangle,
/// as a merged layer's `uvMethod` names the unwrap (`method`): its patches unwrapped at the
/// merge's settings (`MERGE_PATCHES`) and packed as that unwrap packs them (`uv::unwrap`) — as its
/// maps made them where the packer finds no layout —; its charts cut and packed (`uv::charts`), a
/// triangle set aside at the origin held by no chart; or its spectral charts (`MERGE_STRETCH`).
/// None where the unwrap fails (the spectral charts cut or pack nothing): the caller keeps what
/// the mesh has, its own first texture set.
pub(super) fn unwrapped(
    points: &[[f64; 3]],
    triangles: &[[usize; 3]],
    method: HlodUvMethod,
) -> Option<(Vec<[f64; 2]>, Vec<bool>)> {
    let topology = Topology { points, triangles };
    let settings = UvSettings {
        method,
        patches: &MERGE_PATCHES,
        stretch: MERGE_STRETCH,
    };
    let unwrapped = laid(&topology, &settings)?;
    Some((unwrapped.corners, unwrapped.held))
}

/// A mesh's points, its triangles over them and one normal per corner.
type CornerMesh<'a> = (&'a [[f64; 3]], &'a [[usize; 3]], &'a [[f32; 3]]);

/// The views' bounding sphere, its centre and radius, and the distance in metres the actor is
/// first drawn at.
type Framing = (([f64; 3], f64), f64);

/// An approximated shell given unique texture coordinates as `approximation` names their method
/// (`unwrapped_by`), its vertices split by them (`split`).
fn charted(
    (points, triangles, normals): CornerMesh<'_>,
    (texture_size, approximation): (usize, &HlodApproximation),
) -> Flat {
    let topology = Topology { points, triangles };
    let settings = UvSettings {
        method: approximation.uv_method,
        patches: &approximation.patches,
        stretch: approximation.uv_atlas_stretch as f32,
    };
    let corners = unwrapped_by(&topology, texture_size, &settings);
    split((points, triangles, normals), corners)
}

/// The mesh of `points`, `triangles` over them and `normals` per corner, its vertices split by its
/// corners' texture coordinates `corners` and by the tangents averaged over those wedges
/// (`approximate::tangents`).
fn split((points, triangles, normals): CornerMesh<'_>, corners: Vec<[f64; 2]>) -> Flat {
    // Each corner's wedge: its point, its normal's and its coordinates' bits, numbered in the order
    // corners first name them (`first_seen`).
    use rayon::prelude::*;
    let keys: Vec<(usize, [u32; 3], [u32; 2])> = (corners.par_iter().enumerate())
        .map(|(corner, uv)| {
            let uv = uv.map(|x| (x as f32).to_bits());
            (
                triangles[corner / 3][corner % 3],
                normals[corner].map(f32::to_bits),
                uv,
            )
        })
        .collect();
    drop(corners);
    let (wedges, wedge_of) = first_seen::first_seen(keys);
    // Each corner's tangent over its wedge's normal and coordinates as stored.
    let normal_of: Vec<[f64; 3]> = (wedges.iter())
        .map(|w| w.1.map(|x| f64::from(f32::from_bits(x))))
        .collect();
    let uv_of: Vec<[f64; 2]> = (wedges.iter())
        .map(|w| w.2.map(|x| f64::from(f32::from_bits(x))))
        .collect();
    let tangents = approximate::tangents((points, triangles), &wedge_of, (&normal_of, &uv_of));
    drop((normal_of, uv_of));
    // Each corner's vertex: its wedge and its tangent's bits.
    let keys: Vec<(u32, [u32; 4])> = (wedge_of.par_iter().zip(&tangents))
        .map(|(&w, t)| (w, t.map(|x| (x as f32).to_bits())))
        .collect();
    drop(tangents);
    let (vertices, indices) = first_seen::first_seen(keys);
    let mut flat = Flat {
        positions: Vec::with_capacity(vertices.len() * 3),
        normals: Vec::with_capacity(vertices.len() * 3),
        uvs: Vec::with_capacity(vertices.len() * 2),
        tangents: Vec::with_capacity(vertices.len() * 4),
        colours: Vec::new(),
        indices,
    };
    for (w, tangent) in vertices {
        let (v, n, uv) = wedges[w as usize];
        flat.positions.extend(points[v].map(|x| x as f32));
        flat.normals.extend(n.map(f32::from_bits));
        flat.uvs.extend(uv.map(f32::from_bits));
        flat.tangents.extend(tangent.map(f32::from_bits));
    }
    flat
}

/// The bounding sphere of the objects `placements` places, centre and radius: each one's mesh
/// bounds placed by its matrix, gathered as a merged actor's are (`merge::sphere`).
fn framed(placements: &Placements) -> ([f64; 3], f64) {
    let bounds: Vec<MeshBounds> = (placements.meshes.iter())
        .map(|mesh| MeshBounds::of(&mesh.positions, 0..(mesh.positions.len() / 3) as u32))
        .collect();
    merge::sphere((placements.placed.iter()).map(|(mesh, matrix)| (bounds[*mesh], matrix)))
}

/// An approximated layer's actor: the approximation's shell of the objects `placements` places
/// (`approximate`) at the layer's accuracy within its deviation (`layer_settings`) and as its
/// other settings name its steps (`HlodLayer::approximation`), given unique texture coordinates
/// and those same objects, placed in world space (`objects`), in their materials of `library`
/// read onto it through views framing their bounding sphere (`framed`, `baked`), its atlas sized
/// as the layer says, the actor first drawn `seen` metres away (`atlas_sides`). `Ok(Err)` with
/// the reason the shell could not be made and the triangles of its steps done; `Err` when the GPU
/// failed its shell or its atlas.
pub(crate) fn approximated(
    layer: &HlodLayer,
    (placements, objects): (Placements, Vec<Object>),
    (library, seen): (&Library, f64),
) -> crate::Result<Built> {
    let settings = layer_settings(layer);
    let sphere = framed(&placements);
    let shell = approximate::approximate(
        &placements,
        (settings.accuracy, settings.deviation),
        &layer.approximation,
        &library.cancelled,
    )?;
    drop(placements);
    let shell = match shell {
        Ok(shell) => shell,
        Err(reason) => return Ok(Err(reason)),
    };
    baked(
        (shell.positions, shell.indices, shell.normals),
        (objects, (sphere, seen), library),
        (settings.texture_size, &layer.approximation),
        (shell.stages, shell.ms),
    )
    .map(Ok)
}

/// The square root of the share of the atlas's square `flat`'s coordinates cover over its area:
/// its texels a metre per texel of side.
fn texel_ratio(flat: &Flat) -> f64 {
    let (mut area, mut covered) = (0.0, 0.0);
    for t in flat.indices.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|v| point(&flat.positions, v));
        area += triangle_area(a, b, c);
        let [p, q, r] = t.map(|v| flat.uv(v as usize));
        covered += 0.5 * ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])).abs();
    }
    (covered / area).sqrt()
}

/// The side an approximated atlas is baked at and each of its images' own, as the layer's sizing
/// gives them (`merge::atlas_sides`): one side for every image — the layer's `texture_size`, or the
/// power of two the density its sizing asks for gives the shell `flat`, its texels a metre over
/// its charts' share of the square (`texel_ratio`), the sources' bounding sphere `radius` and the
/// distance `seen` the actor is first drawn from —; or each image its own, the bake at the largest
/// of the six a sizing names (`HlodMapSides::largest`).
fn atlas_sides(
    flat: &Flat,
    (texture_size, sizing): (usize, HlodAtlasSizing),
    (radius, seen): (f64, f64),
) -> (usize, Sides) {
    let own = |maps: &HlodMapSides| (maps.largest(), Sides::of(maps));
    let reach = || (texel_ratio(flat), radius, seen);
    merge::atlas_sides((sizing, texture_size), reach, (APPROXIMATION_FLOORS, own))
}

/// A shell's actor: `positions` and `indices`, one normal per corner, given unique texture
/// coordinates of a `texture_size` atlas as `approximation` names their method (`charted`), and the
/// `objects` it stands for, each wearing its material of `library`, read onto it through the views
/// of them `approximation` sets around their bounding sphere `framed` (`bake::captured`), dropped
/// once traced, its atlas sized as the layer says, the actor first drawn `seen` metres away
/// (`atlas_sides`). `stages` its triangles after each step, `ms` the milliseconds of the steps
/// before, given the unwrap's and the bake's here. `Err` when its atlas could not be baked.
fn baked(
    (positions, indices, normals): (Vec<f32>, Vec<u32>, Vec<[f32; 3]>),
    (objects, (framed, seen), library): (Vec<Object>, Framing, &Library),
    (texture_size, approximation): (usize, &HlodApproximation),
    (stages, mut ms): (Stages, StageMs),
) -> crate::Result<Made> {
    let flat = timed(&mut ms[step::UNWRAP], || {
        let (points, triangles) = (tree::points_of(&positions), tree::triangles_of(&indices));
        charted(
            (&points[..], &triangles[..], &normals[..]),
            (texture_size, approximation),
        )
    });
    drop(normals);
    let traced = pieces(&objects);
    let views = bake::capture::views(framed, &approximation.capture, texture_size);
    let mut sources = sources::Sources::of(&traced, library);
    drop(traced);
    drop(objects);
    let atlas = timed(&mut ms[step::BAKE], || {
        let (nodes, _) = tree::order_sources(&mut sources.mesh);
        let read = (&nodes[..], &views);
        let maps = (
            approximation.maps,
            approximation.capture.multisampling,
            approximation.empty_texels,
        );
        let sized = (texture_size, approximation.sizing);
        let sides = atlas_sides(&flat, sized, (framed.1, seen));
        bake::captured(&flat, sides, (&sources, library), read, maps)
    })?;
    Ok(Made {
        flat,
        atlas,
        stages,
        stage_ms: ms,
    })
}
