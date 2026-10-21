//! The merged mesh flattened (`mergeMaterials`): one atlas of every material it wears, each baked
//! into its own cell, and the bytes a cut and its work hold.
//!
//! - Entries: one per material each part wears and what it is baked on. A part whose look its own
//!   mesh decides (`reads_mesh`) — a texture set leaving the unit square, a vertex colour, a baked
//!   map reading a second set — is baked on that mesh's triangles, laid at its lightmap texture
//!   set where the layer reuses it and the mesh has one, else at texture coordinates generated
//!   once per mesh (`laid_out`), when the layer bakes on meshes (`bakeOnMesh`, on by default); so
//!   is a translucent part the layer sees through (`seen_through`), whatever `bakeOnMesh` says,
//!   its look what lies behind it, which no quad holds: its texels laid over the merged mesh's
//!   parts behind them (`tile::Behind`). Every other is baked on a full-frame quad of its
//!   material (`quad`), the tile its own texture coordinates address. Parts of one material and
//!   one ground share one entry, one bake: every quad of a material is one, a mesh's parts
//!   mirrored alike are one, read behind as its first part lies.
//! - Each entry baked at the atlas's side, one sample a texel (`tile.rs`), its images then shrunk
//!   to one texel when they hold one value, their background filled outward (`smear.rs`) and
//!   placed in the entry's cell (`grid.rs`); the atlas's background filled outward from the cells,
//!   each image then averaged down to its own side where the layer sizes its maps apart
//!   (`Flattening::sides`). The emission images, each held over its entry's own strength, are
//!   brought onto the largest (`emission`).
//! - The mesh: every part's vertices, its normals kept, its texture coordinates — its own on a
//!   quad, the laid ones on its mesh — moved into its entry's cell, `uv · scale + offset`.
//!   The flattened material draws both faces when one of its materials does and the layer allows
//!   it (`allowDoubleSided`, on by default).
//!
//! What an entry is baked on lives in `ground`, the mesh laid into the atlas in `remap`, the
//! atlas's side and the bytes a cut and its work hold in `sizing`, the emission atlas in
//! `emission`.
use super::super::bake::appearance::tone;
use super::super::bake::sources::{Piece, Sources};
use super::super::bake::{sized, Emission, Maps};
use super::super::uv::raster::{EMPTY, SAMPLED};
use super::super::{step, Atlas, Library, Made, Sides, StageMs, Stages};
use super::grid::{binned, grid, placed, Cell};
use super::smear::{shrunk, smeared, uniform, Image};
use super::tile::{baked, Baked, Behind};
use super::Part;
use crate::hlod::options::HlodUvMethod;
use rayon::prelude::*;
use std::collections::BTreeMap;
mod emission;
use emission::rescaled;
mod ground;
pub(in crate::hlod) use ground::{coordinates, lightmapped, quad, seen_through};
use ground::{laid_out, oriented, reads_mesh, Ground};
mod remap;
use remap::{occupancy, remapped};
mod sizing;
pub(in crate::hlod) use sizing::{area, atlas_sides, cut_bytes, sphere, working_bytes};

/// How a merged layer flattens its materials: the atlas's side (`side`), each cell's gutter in
/// texels (`atlasGutter`), whether the cells are binned by their materials' texture sizes
/// (`binByTextureSize`), whether a part whose look its mesh decides bakes on that mesh
/// (`bakeOnMesh`) and at which coordinates — its lightmap set where `lightmaps.0` reuses it, else
/// generated as `lightmaps.1` unwraps —, whether the flattened material may draw both faces
/// (`allowDoubleSided`), and the maps baked beside the base colour (`maps`) with how a translucent
/// source shows in them (`translucency`). The atlas is baked at `side`, each image then averaged
/// down to its own of `sides` (`atlas_sides`).
pub(in crate::hlod) struct Flattening {
    pub side: usize,
    pub sides: Sides,
    pub gutter: usize,
    pub binned: bool,
    pub on_mesh: bool,
    pub lightmaps: (bool, HlodUvMethod),
    pub double_sided: bool,
    pub maps: Maps,
}

/// Each entry's share of a binned atlas: its material's largest texture in texels — at least
/// 64 × 64 —, over the sum of every entry's.
fn weights(materials: &[Option<u64>], library: &Library) -> Vec<f64> {
    let largest = |material: Option<u64>| {
        let surface = library.surface(material);
        [
            &surface.colour,
            &surface.metal_rough,
            &surface.occlusion,
            &surface.normal_map,
        ]
        .into_iter()
        .flatten()
        .map(|texels| {
            let (width, height, _) = texels.levels()[0];
            (width * height) as f64
        })
        .fold(64.0 * 64.0, f64::max)
    };
    let sizes: Vec<f64> = materials.iter().map(|&m| largest(m)).collect();
    let total: f64 = sizes.iter().sum();
    sizes.iter().map(|s| s / total).collect()
}

/// The merged mesh's one actor when its materials are merged (`mergeMaterials`): its `parts` with
/// their materials of `library` flattened into one atlas as `flattening` says (module doc), the
/// job's `checkpoint` read before each entry's bake.
pub(in crate::hlod) fn merged_flat(
    parts: &[Part],
    (library, checkpoint): (&Library, &(dyn Fn() -> crate::Result<()> + Sync)),
    flattening: &Flattening,
) -> crate::Result<Made> {
    let Flattening {
        side,
        sides,
        gutter,
        maps,
        ..
    } = *flattening;
    let parts: Vec<&Part> = parts.iter().filter(|p| !p.geometry.2.is_empty()).collect();
    let corners: usize = parts.iter().map(|p| p.geometry.2.len()).sum();
    let stages: Stages = [corners / 3; super::super::STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let seen: Vec<bool> = parts
        .iter()
        .map(|p| seen_through(p, library, maps))
        .collect();
    let grounds: Vec<Ground> = (parts.iter().zip(&seen))
        .map(|(p, &through)| {
            match through || (flattening.on_mesh && reads_mesh(p, library, maps)) {
                true => Ground::Mesh(p.mesh, p.mirrored),
                false => Ground::Quad,
            }
        })
        .collect();
    // The entries in the order the parts first name them, each with its first part.
    let mut entries: Vec<(Option<u64>, Ground, usize)> = Vec::new();
    let entry_of: Vec<usize> = (parts.iter().zip(&grounds).enumerate())
        .map(|(k, (part, &ground))| {
            let same =
                |&(m, g, _): &(Option<u64>, Ground, usize)| m == part.material && g == ground;
            let found = entries.iter().position(same);
            found.unwrap_or_else(|| {
                entries.push((part.material, ground, k));
                entries.len() - 1
            })
        })
        .collect();
    // Each mesh baked on its own triangles: its coordinates, laid once from its first part, the
    // meshes side by side.
    let mut firsts: BTreeMap<usize, &Part> = BTreeMap::new();
    for (part, ground) in parts.iter().zip(&grounds) {
        if let Ground::Mesh(mesh, _) = *ground {
            firsts.entry(mesh).or_insert(*part);
        }
    }
    let laid: BTreeMap<usize, Vec<[[f64; 2]; 3]>> = firsts
        .into_par_iter()
        .map(|(mesh, part)| (mesh, laid_out(part, flattening.lightmaps)))
        .collect();
    ms[step::UNWRAP] = super::super::millis(started);
    let started = std::time::Instant::now();
    // What lies behind the translucent parts seen through: every part, traced once.
    let behind = seen.contains(&true).then(|| {
        let pieces: Vec<Piece> = parts.iter().map(|p| p.piece()).collect();
        Behind::of(&pieces, library)
    });
    let materials: Vec<Option<u64>> = entries.iter().map(|&(m, ..)| m).collect();
    let cells = match flattening.binned {
        true => binned(&weights(&materials, library), side, gutter),
        false => grid(entries.len(), side, gutter),
    };
    // The atlas's base colour, and its other maps where they are baked: the normal, the
    // metal-roughness, the emission, the occlusion and the anisotropy.
    let blank = |baked: bool| baked.then(|| Image::background(side, side));
    let mut base_map = Image::background(side, side);
    let mut maps_baked = [
        blank(maps.normal),
        blank(maps.metal_rough()),
        blank(maps.emissive),
        blank(maps.occlusion),
        blank(maps.anisotropic()),
    ];
    // An entry's image shrunk, its background filled and placed in its cell.
    let place = |atlas: &mut Image, mut image: Image, cell: &Cell| {
        shrunk(&mut image);
        smeared(&mut image);
        uniform(&mut image);
        placed(atlas, &image, cell);
    };
    let mut strengths = Vec::with_capacity(entries.len());
    for (&(material, ground, first), cell) in entries.iter().zip(&cells) {
        checkpoint()?;
        let Baked {
            base,
            normal,
            metal_rough,
            emission,
            emission_strength,
            occlusion,
            anisotropy,
        } = match ground {
            Ground::Quad => {
                let (sources, coordinates) = quad(material, library);
                baked(&sources, &coordinates, (side, maps), None)
            }
            Ground::Mesh(mesh, mirrored) => {
                let sources = Sources::of(&[parts[first].piece()], library);
                let coordinates: Vec<[[f64; 2]; 3]> =
                    laid[&mesh].iter().map(|&t| oriented(t, mirrored)).collect();
                let behind = behind.as_ref().filter(|_| seen[first]);
                baked(&sources, &coordinates, (side, maps), behind)
            }
        };
        strengths.push(emission_strength);
        place(&mut base_map, base, cell);
        let images = [normal, metal_rough, emission, occlusion, anisotropy];
        for (atlas, image) in maps_baked.iter_mut().zip(images) {
            if let (Some(atlas), Some(image)) = (atlas.as_mut(), image) {
                place(atlas, image, cell);
            }
        }
    }
    // The emission atlas held over the largest strength any entry's emission is held over.
    let strength = strengths.iter().copied().fold(0.0f32, f32::max);
    if let Some(atlas) = maps_baked[2].as_mut() {
        rescaled(atlas, (&cells, &strengths), strength);
    }
    // Each map's background filled outward from the cells: the gutters and the empty cells.
    let finished = |mut image: Image| {
        smeared(&mut image);
        image.texels.into_flattened()
    };
    let base = finished(base_map);
    let [normal, metal_rough, emission, occlusion, anisotropy] =
        maps_baked.map(|image| image.map(finished));
    let flat = remapped(&parts, (&grounds, &entry_of), (&laid, &cells));
    let occupancy = occupancy(&cells, side);
    let double_sided =
        flattening.double_sided && parts.iter().any(|p| library.double_sided(p.material));
    // Each image averaged down to its own side: the base colour — its alpha too — and the colours
    // of the emission in sRGB, the others as stored.
    let own = |image: Vec<u8>, to: usize, srgb: bool| sized(image, (side, to), srgb);
    let atlas = Atlas {
        sides,
        tone: [
            tone(&base, &occupancy, &[SAMPLED]),
            tone(&base, &occupancy, &[SAMPLED, EMPTY]),
        ],
        base: own(base, sides.base, true),
        normal: normal.map(|image| own(image, sides.normal, false)),
        metal_rough: metal_rough.map(|image| own(image, sides.metal_rough, false)),
        specular: maps.specular,
        emission: emission.map(|image| Emission {
            image: own(image, sides.emission, true),
            strength,
        }),
        occlusion: occlusion.map(|image| own(image, sides.occlusion, false)),
        anisotropy: anisotropy.map(|image| own(image, sides.anisotropy, false)),
        coverage: maps.coverage(),
        double_sided,
    };
    ms[step::BAKE] = super::super::millis(started);
    Ok(Made {
        flat,
        atlas,
        stages,
        stage_ms: ms,
    })
}
