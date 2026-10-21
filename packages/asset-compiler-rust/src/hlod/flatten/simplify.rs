//! The `simplify` HLOD builder: its cell's original objects — every object under the cell, whatever
//! its level, never an actor below — remeshed through their volume, simplified for the distance the
//! actor is first drawn from, charted, and their materials transferred onto the result:
//!
//! 1. the objects at their level 0, placed in world space, in the method's frame — centimetres,
//!    our `y` and `z` swapped (`sources`) —; the screen size, in pixels of a 1920-texel view, their
//!    bounding sphere spans where the actor is first drawn (`resolution::pixels`), and the voxel —
//!    the layer's `voxel`, else the bounds' largest side over that pixel count, held from 50
//!    to 900, times 1.95 / 3 (`resolution::voxel`);
//! 2. their materials flattened, each object's textured material on the object's own generated
//!    coordinates — its meshes' lightmap set where the layer reuses it (`reuseLightmapUVs`) —,
//!    every other on a quad (`flattened`), the objects placing one mesh baked once where the layer
//!    groups them (`groupIdenticalMeshes`, `parts`), at the side the layer's sizing gives over the
//!    objects' area and sphere (`merge::atlas_sides`);
//! 3. the mesh: the field, the gaps closed, the surface, the source normals and the projection,
//!    the reduction, the normals and the hard edges (`shape`);
//! 4. the atlas: its sides from the mesh's own area and sphere by the layer's sizing, the grid
//!    at least 64 texels for the charts and the transfer; the mesh cleaned of bowties and charted
//!    by the spectral partition, the charts packed with the layer's gutter (`charts`); a mesh that
//!    cannot be charted fails the actor; then, in our frame, each vertex's tangent frame
//!    (`tangents`);
//! 5. the transfer (`transfer`): every texel of the atlas paired with the sources by rays along the
//!    kept normals, as far as the layer's `transferDistance` (six voxels by default, at least one,
//!    at most the bounds' largest side), and each map read from the sources' flattened images —
//!    base colour, normal map, roughness, metallic, specular, emission and coverage as the layer's
//!    `maps` bake them —, a texel no source answers the layer's `unresolvedColor`; the normal map
//!    written in the frame of the mesh's tangents;
//! 6. the actor's mesh back in our frame with its tangents and, where the layer carries the
//!    sources' vertex colours onto it (`allowVertexColors`), its colours (`transfer::vertex`);
//!    its material drawing both faces when one of its sources' does and the layer allows it
//!    (`allowDoubleSided`); its images' sides each its own (`output`).
//!
//! The method's numbers live in `resolution`, its sources in `sources`, the steps' meshes in
//! `proxy`, its volume in `volume`, the reduction in `reduce`, the charts' cleaning in `adjacency`
//! and `clean`, the transfer's rays in `kdop`.
use super::merge::{area, atlas_sides, sphere, MeshBounds};
use super::units::{CENTIMETRES, SQUARE_CENTIMETRES};
use super::{millis, step, Built, Library, Made, Sides};
use crate::hlod::chain::Instance;
use crate::hlod::options::{HlodEmptyTexels, HlodMapSides, APPROXIMATION_FLOORS, MERGE_FLOORS};
use crate::HlodLayer;
use trillion3d_page_codec::FLAG_COLOR;
mod adjacency;
mod charts;
mod clean;
mod convert;
mod flattened;
mod hard;
mod kdop;
mod nearest;
mod normals;
mod output;
mod parts;
mod proxy;
mod reduce;
mod resolution;
mod shape;
mod sources;
mod tangents;
mod transfer;
mod volume;
mod walls;
use nearest::Nearest;
use sources::{normals_of, Sources, Taken};
use transfer::{transferred, vertex_colours, Frames, Transfer};

/// The least side of the grid the charts are packed for and the transfer samples on.
const LEAST_GRID: usize = 64;

/// The ray length, in voxels, when the layer names no `transferDistance`.
const RAY_VOXELS: f64 = 6.0;

/// The bytes a texel of the transfer's grid holds while it is read: its raster entry (40), its
/// maps' values as read and as filled (≈ 132: base colour, normal and emission four floats each,
/// specular, roughness and metallic three, coverage one, twice, and its validity), its occupancy
/// and its output bytes (≈ 20); its sixteen samples are read row by row and never held
/// (`transfer`).
const TRANSFER_TEXEL_BYTES: usize = 192;

/// The bytes a simplified actor holds while it is made from `triangles` source triangles into an
/// atlas of `side` texels cooked for `families` block families: its sources, placed, flattened and
/// read by the method (`flatten::SOURCE_TRIANGLE_BYTES`), the transfer's grid at least 64 texels a
/// side (`TRANSFER_TEXEL_BYTES`) and the atlas's three images cooked side by side.
pub(crate) fn working_bytes(triangles: usize, side: usize, families: usize) -> usize {
    let grid = side.max(LEAST_GRID);
    let cooked = crate::texture::admission::cook_bytes(side as u32, families);
    (triangles.saturating_mul(super::SOURCE_TRIANGLE_BYTES))
        .saturating_add((grid * grid).saturating_mul(TRANSFER_TEXEL_BYTES))
        .saturating_add(cooked.saturating_mul(3))
}

/// Simplified layer `layer`'s actor of the cell whose original objects are `members` of
/// `instances`, first drawn `seen` metres away, its materials from `library` (module doc);
/// `Ok(Err)` with the reason it could not be made and the triangles of its steps done; `Err` when
/// the job was cancelled.
pub(crate) fn simplified(
    layer: &HlodLayer,
    (instances, members): (&[Instance], &[usize]),
    seen: f64,
    library: &Library,
) -> crate::Result<Built> {
    let settings = &layer.simplifying;
    let cancelled = &library.cancelled;
    let mut ms = [0; step::COUNT];
    let (parts, homes) = parts::gathered(instances, members, settings.group_identical);
    let stages = [0; super::STAGE_COUNT];
    if parts.is_empty() {
        return Ok(Err(("the cell has no source triangle", stages)));
    }
    let placed = (members.iter()).map(|&i| {
        let cover = instances[i].cover;
        let bounds = MeshBounds::of(&cover.positions, cover.indices.iter().copied());
        (bounds, &instances[i].matrix)
    });
    let radius = sphere(placed).1;
    let pixels = resolution::pixels(radius, seen);
    let started = std::time::Instant::now();
    let maps = settings.maps;
    // The sizing's sides, the sources' bake at the largest, an atlas's as a proxy's material
    // is sized: the biased sizes' floors the sources' (8, 4) and the atlas's (32, 16).
    let sizing = (settings.sizing, layer.texture_size);
    let own = |sizes: &HlodMapSides| Sides::of_baked(sizes, maps);
    let source_area = area(&parts);
    let (bake_side, _) = atlas_sides(
        sizing,
        || (1.0 / source_area.sqrt(), radius, seen),
        (MERGE_FLOORS, own),
    );
    let flattening = flattened::flattened(
        (&parts, &homes),
        (library, maps),
        (bake_side, settings.reuse_lightmap_uvs),
    )?;
    let double_sided =
        settings.double_sided && parts.iter().any(|p| library.double_sided(p.material));
    let taken: Vec<Taken> = (parts.iter().enumerate())
        .map(|(k, part)| {
            let (positions, carried, indices) = &part.geometry;
            Taken {
                positions,
                normals: normals_of(positions, carried, indices),
                colours: part.carried(FLAG_COLOR),
                indices,
                set: flattening.sets[k],
                laid: flattening.laid[k]
                    .as_deref()
                    .map(<[[[f64; 2]; 3]]>::as_flattened),
            }
        })
        .collect();
    let sources = Sources::of(&taken);
    drop(taken);
    drop(parts);
    let mut baking = millis(started);
    if !sources.has_volume() {
        return Ok(Err(("the sources' bounds hold no volume", stages)));
    }
    let voxel = resolution::voxel(pixels, sources.major_axis(), settings.voxel);
    let shaped = match shape::shaped(&sources, (voxel, pixels), settings, cancelled)? {
        Ok(shaped) => shaped,
        Err(reason) => return Ok(Err(reason)),
    };
    let shape::Shaped {
        mut proxy,
        closest,
        stages,
        ms: shaped_ms,
    } = shaped;
    ms.iter_mut()
        .zip(shaped_ms)
        .for_each(|(at, spent)| *at += spent);
    let started = std::time::Instant::now();
    // The mesh's own area and sphere, square metres and metres, size its atlas.
    let mesh_area = proxy.area() / SQUARE_CENTIMETRES;
    let mesh_radius = f64::from(proxy.radius()) / CENTIMETRES;
    let (atlas_side, sides) = atlas_sides(
        sizing,
        || (1.0 / mesh_area.sqrt(), mesh_radius, seen),
        (APPROXIMATION_FLOORS, own),
    );
    let grid = atlas_side.max(LEAST_GRID);
    if !charts::charted(&mut proxy, grid, settings.gutter as f32) {
        return Ok(Err(("the simplified mesh could not be charted", stages)));
    }
    let (points, normals) = output::in_our_frame(&proxy);
    let mesh = (&points[..], &normals[..], &proxy.uvs[..]);
    let tangents = tangents::vertex_tangents(mesh, &proxy.indices);
    ms[step::UNWRAP] = millis(started);
    let started = std::time::Instant::now();
    let major = f64::from(sources.major_axis());
    let asked = (settings.transfer_distance).map_or(RAY_VOXELS * voxel, |d| d * CENTIMETRES);
    let transfer = Transfer {
        grid,
        sides,
        reach: voxel.max(asked.min(major)),
        rays: settings.rays,
        unresolved: settings.unresolved,
        maps,
        dilate: settings.empty_texels == HlodEmptyTexels::NearestChart,
        frames: Frames {
            normals: &normals,
            tangents: &tangents,
        },
    };
    let transferred = transferred(&proxy, &sources, &flattening.entries, &transfer, cancelled)?;
    // The sources' colours carried onto the mesh's vertices, the tree of their closest triangles
    // kept for it (`shape`).
    let colours = closest.map_or_else(Vec::new, |closest| {
        let nearest = Nearest {
            closest: &closest,
            sources: &sources,
            voxel,
        };
        vertex_colours(&nearest, &proxy.points)
    });
    baking += millis(started);
    ms[step::BAKE] = baking;
    // An emission map's strength, the largest of its entries' (each entry's image held over its
    // own).
    let strength = (flattening.entries.iter()).fold(0.0, |most, entry| entry.strength.max(most));
    Ok(Ok(Made {
        flat: output::flat(proxy, (points, normals, tangents), colours),
        atlas: output::atlas(transferred, (sides, maps, strength), double_sided),
        stages,
        stage_ms: ms,
    }))
}
