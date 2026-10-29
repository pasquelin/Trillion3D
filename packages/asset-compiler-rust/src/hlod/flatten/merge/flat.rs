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
//! - A layer that does not reuse its meshes' lightmap sets (`reuseLightmapUVs: false`) lays every
//!   mesh out together instead: every entry is baked on its mesh, whatever `bakeOnMesh` says, at
//!   coordinates generated once for all the entries' triangles as one mesh (`global`), and all of
//!   them into the one atlas, no cell and no gutter (`images`).
//! - Each entry baked at the atlas's side, one sample a texel, on the GPU (`tile.rs`), its images
//!   then shrunk to one texel when they hold one value, their background filled outward
//!   (`smear.rs`) and placed in the entry's cell (`grid.rs`); the atlas's background filled
//!   outward from the cells, each image then averaged down to its own side where the layer sizes
//!   its maps apart (`Flattening::sides`). The emission images, each held over its entry's own
//!   strength, are brought onto the largest (`emission`).
//! - The mesh: every part's vertices, its normals kept, its texture coordinates — its own on a
//!   quad, the laid ones on its mesh — moved into its entry's cell, `uv · scale + offset`.
//!   The flattened material draws both faces when one of its materials does and the layer allows
//!   it (`allowDoubleSided`, on by default).
//!
//! What an entry is baked on lives in `ground`, the coordinates the meshes are laid at together in
//! `global`, the old layout in `legacy`, the images of the atlas in `images`, the mesh laid into
//! the atlas in `remap`, the atlas's side and the counts a cut holds in `sizing`, the bytes its
//! making holds in `working`, the emission atlas in `emission`.
use super::super::bake::appearance::tone;
use super::super::bake::{sized, Emission, Maps};
use super::super::uv::raster::{EMPTY, SAMPLED};
use super::super::{step, Atlas, Library, Made, Sides, StageMs, Stages};
use super::tile::{Behind, Read};
use super::Part;
use crate::hlod::options::HlodUvMethod;
use rayon::prelude::*;
use std::collections::BTreeMap;
mod emission;
mod entries;
use entries::{cells_of, entries_of, grounds_of, weights, Entry};
mod global;
use global::laid_together;
mod ground;
pub(in crate::hlod) use ground::{coordinates, lightmapped, quad, seen_through};
use ground::{generated, laid_out, reads_mesh, Ground};
mod images;
use images::{Finished, Images};
mod legacy;
mod remap;
use remap::{remapped, Laid};
mod sizing;
pub(in crate::hlod) use sizing::{area, atlas_sides, cut_counts, sphere};
mod working;
pub(in crate::hlod) use working::{working_bytes, Flattened};

/// How a merged layer flattens its materials: the atlas's side (`side`), each cell's gutter in
/// texels (`atlasGutter`), whether the cells are binned by their materials' texture sizes
/// (`binByTextureSize`), whether a part whose look its mesh decides bakes on that mesh
/// (`bakeOnMesh`) and at which coordinates — its lightmap set where `lightmaps.0` reuses it, else
/// generated as `lightmaps.1` unwraps, per mesh, or for all its meshes together where it does not
/// reuse them (`global`, which has no cell, gutter or binning, and bakes every entry on its
/// mesh) —, whether the flattened material may draw both faces (`allowDoubleSided`), and the maps
/// baked beside the base colour (`maps`) with how a translucent source shows in them
/// (`translucency`). The atlas is baked at `side`, each image then averaged down to its own of
/// `sides` (`atlas_sides`).
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

impl Flattening {
    /// Whether the layer lays its meshes out together (`reuseLightmapUVs: false`, `global`): every
    /// entry is baked on its mesh into the whole atlas, with no cell, gutter or binning.
    pub(in crate::hlod) fn together(&self) -> bool {
        !self.lightmaps.0
    }
}

/// The coordinates the entries' meshes are baked and laid at (`Laid`): where the layer lays its
/// meshes out `together`, all of them at once (`global`); else, or where that fails — the unwrap of
/// the whole cuts or packs nothing —, each mesh's on its own, generated once from its first part,
/// the meshes side by side: its lightmap set where the layer reuses it (`laid_out`), what is
/// generated for it alone where it does not (`generated`), so that a failing unwrap of the whole
/// leaves each mesh the coordinates of its own unwrap.
fn laid_of(
    parts: &[&Part],
    (grounds, entries): (&[Ground], &[Entry]),
    (together, method, side): (bool, HlodUvMethod, usize),
) -> Laid {
    if together {
        let firsts: Vec<&Part> = entries.iter().map(|&(.., first)| parts[first]).collect();
        if let Some(sets) = laid_together(&firsts, method, side) {
            return Laid::PerEntry(sets);
        }
    }
    let mut firsts: BTreeMap<usize, &Part> = BTreeMap::new();
    for (part, ground) in parts.iter().zip(grounds) {
        if let Ground::Mesh(mesh, _) = *ground {
            firsts.entry(mesh).or_insert(*part);
        }
    }
    let lay = |part: &Part| match together {
        true => generated(part, method, side),
        false => laid_out(part, method, side),
    };
    Laid::PerMesh(
        (firsts.into_par_iter())
            .map(|(mesh, part)| (mesh, lay(part)))
            .collect(),
    )
}

/// What an entry's bake reads, besides its own parts: the parts of the merged mesh, and which of
/// them are seen through.
struct Scene<'a> {
    parts: &'a [&'a Part],
    behind: Option<Behind>,
    seen: &'a [bool],
    library: &'a Library,
}

/// Entry number `rank` baked into the atlas `images` at the atlas's side: a quad of its material,
/// or its mesh's triangles at the coordinates `laid` gives it, read among the merged mesh where it
/// is seen through.
fn bake_entry(
    (rank, (material, ground, first)): (usize, Entry),
    laid: &Laid,
    scene: &Scene,
    images: &mut Images,
) -> crate::Result<()> {
    let library = scene.library;
    let Ground::Mesh(mesh, mirrored) = ground else {
        let (sources, coordinates) = quad(material, library);
        return images.bake(rank, (Read::Own(&sources), &coordinates), library);
    };
    let coordinates: Vec<[[f64; 2]; 3]> = laid.of_entry(rank, mesh, mirrored).iter().collect();
    let behind = scene.behind.as_ref().filter(|_| scene.seen[first]);
    let piece_of = |k: usize| scene.parts[k].piece();
    Read::of(behind, &[first], piece_of, library, |read| {
        images.bake(rank, (read, &coordinates), library)
    })
}

/// The atlas of the finished images `done`, each averaged down to its own side of `sides`: the
/// base colour — its alpha too — and the colours of the emission in sRGB, the others as stored.
fn atlas_of(
    done: Finished,
    (side, sides, maps): (usize, Sides, Maps),
    double_sided: bool,
) -> Atlas {
    let Finished {
        base,
        normal,
        metal_rough,
        emission,
        occlusion,
        anisotropy,
        strength,
        occupancy,
    } = done;
    let own = |image: Vec<u8>, to: usize, srgb: bool| sized(image, (side, to), srgb);
    Atlas {
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
    }
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
        side, sides, maps, ..
    } = *flattening;
    let parts: Vec<&Part> = parts.iter().filter(|p| !p.geometry.2.is_empty()).collect();
    let corners: usize = parts.iter().map(|p| p.geometry.2.len()).sum();
    let stages: Stages = [corners / 3; super::super::STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let seen: Vec<bool> = (parts.iter())
        .map(|p| seen_through(p.material, library, maps))
        .collect();
    let together = flattening.together();
    let reads = |part: &Part| flattening.on_mesh && reads_mesh(part, library, maps);
    let grounds = grounds_of(&parts, &seen, (together, reads));
    let (entries, entry_of) = entries_of(&parts, &grounds);
    let at = (together, flattening.lightmaps.1, side);
    let laid = laid_of(&parts, (&grounds, &entries), at);
    ms[step::UNWRAP] = super::super::millis(started);
    let started = std::time::Instant::now();
    // What lies behind the translucent parts seen through: every part, traced once.
    let behind = seen
        .contains(&true)
        .then(|| Behind::of(parts.iter().map(|p| p.piece()), library));
    let scene = Scene {
        parts: &parts,
        behind,
        seen: &seen,
        library,
    };
    let weights = |materials: &[Option<u64>]| weights(materials, library);
    let cells = cells_of(&entries, flattening, (together, weights));
    let mut images = Images::new(side, maps, cells);
    for (rank, &entry) in entries.iter().enumerate() {
        checkpoint()?;
        bake_entry((rank, entry), &laid, &scene, &mut images)?;
    }
    let flat = remapped(&parts, (&grounds, &entry_of), (&laid, images.cells()));
    let double_sided =
        flattening.double_sided && parts.iter().any(|p| library.double_sided(p.material));
    let atlas = atlas_of(images.finished(), (side, sides, maps), double_sided);
    ms[step::BAKE] = super::super::millis(started);
    Ok(Made {
        flat,
        atlas,
        stages,
        stage_ms: ms,
    })
}

#[cfg(test)]
mod tests;
