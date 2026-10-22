//! The sources' materials flattened before the transfer reads them (`flattened`), as the method
//! bakes the materials of the objects it stands for:
//!
//! - a material whose look the mesh decides — a texture in a map the layer bakes (the base colour
//!   always, the normal, metal-roughness, specular and emission maps as its maps say), a vertex
//!   colour on a source wearing it, or a translucent material the layer sees through
//!   (`translucency`) — is baked once per object (a node, all its primitives) wearing it, on that
//!   object's triangles laid at the texture set the object's meshes have at their lightmap index
//!   where the layer reuses it and every primitive has one (`reuseLightmapUVs`,
//!   `merge::lightmapped`), else at texture coordinates generated once for the whole object
//!   (`merge::coordinates`, the merged atlas's unwrap, on the object's primitives taken
//!   together), a translucent texel over what lies behind it among every source
//!   (`merge::Behind`);
//! - every other material is baked once, on a full-frame quad of it (`merge::quad`).
//!
//! Where the layer bakes identical meshes once (`groupIdenticalMeshes`), the objects placing one
//! mesh are one object, baked from the first of them (`parts::Home`): each other's primitive reads
//! the entry and the coordinates of its twin, the primitive of that first object with the same
//! source.
//!
//! Each entry is baked at the side the sources' sizing gives, one sample a texel, on the GPU
//! (`merge::baked`), its images shrunk to one texel when they hold one value and their background
//! filled outward (`merge::shrunk`, `smeared`, `uniform`). Each source primitive then reads its
//! entry's images at its object's generated coordinates, or — on a quad, an image of one texel —
//! anywhere.
use super::parts::Home;
use super::transfer::Flattened;
use crate::hlod::flatten::bake::Maps;
use crate::hlod::flatten::merge::{
    baked, coordinates, lightmapped, quad, seen_through, shrunk, smeared, uniform, Baked, Behind,
    Image, Part, Read,
};
use crate::hlod::flatten::{Library, Piece};
use crate::hlod::options::HlodUvMethod;
use crate::plugins::scene::cancel::check;
use std::collections::BTreeMap;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_UV};

/// What the flattening made: each entry's images, and per source primitive the rank of its
/// entry and, baked on its object, its triangles' corners' coordinates in that entry's images.
pub(super) struct Flattening {
    pub entries: Vec<Flattened>,
    pub sets: Vec<u32>,
    pub laid: Vec<Option<Vec<[[f64; 2]; 3]>>>,
}

/// Whether `material`, worn by the primitives `worn`, is baked on its objects' meshes (module
/// doc).
fn on_mesh(worn: &[&Part], library: &Library, maps: Maps) -> bool {
    let surface = library.surface(worn[0].material);
    let textured = surface.colour.is_some()
        || (maps.metal_rough() && surface.metal_rough.is_some())
        || (maps.normal && surface.normal_map.is_some())
        || (maps.specular && surface.specular_map.is_some())
        || (maps.emissive && surface.emission_map.is_some());
    let tinted = worn.iter().any(|p| p.carried(FLAG_COLOR).is_some());
    textured || tinted || seen_through(worn[0].material, library, maps)
}

/// The texture coordinates the object made of the primitives `parts` is baked at: the texture set
/// each has at its lightmap index where `reuse` and every one has one, else coordinates generated
/// for the whole object, its primitives taken together in order; per primitive, per triangle, its
/// corners' coordinates.
fn object_coordinates(parts: &[&Part], reuse: bool) -> Vec<Vec<[[f64; 2]; 3]>> {
    if reuse {
        let sets = parts.iter().map(|&part| lightmapped(part));
        if let Some(sets) = sets.collect::<Option<Vec<_>>>() {
            return sets;
        }
    }
    let (mut positions, mut uvs, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for part in parts {
        let (own, _, corners) = &part.geometry;
        let base = (positions.len() / 3) as u32;
        positions.extend_from_slice(own);
        match part.carried(FLAG_UV) {
            Some(set) => uvs.extend_from_slice(set),
            None => uvs.resize(uvs.len() + own.len() / 3 * 2, 0.0),
        }
        indices.extend(corners.iter().map(|&v| v + base));
    }
    let carried = vec![Attribute {
        flag: FLAG_UV,
        width: 2,
        values: uvs,
    }];
    let object = Part {
        material: None,
        mesh: 0,
        mirrored: false,
        geometry: (positions, carried, indices),
    };
    let mut laid = coordinates(&object, HlodUvMethod::Patches).into_iter();
    (parts.iter())
        .map(|part| laid.by_ref().take(part.geometry.2.len() / 3).collect())
        .collect()
}

/// `image` as the transfer reads it: shrunk to one texel when it holds one value, its background
/// filled outward.
fn finished(mut image: Image) -> Image {
    shrunk(&mut image);
    smeared(&mut image);
    uniform(&mut image);
    image
}

/// The materials of the source primitives `parts`, each baked on the object `homes` names,
/// flattened at `side` texels with `maps`, reusing the sources' lightmap sets where `reuse`
/// (module doc); the job's cancel token read before each entry's bake.
pub(super) fn flattened(
    (parts, homes): (&[Part], &[Home]),
    (library, maps): (&Library, Maps),
    (side, reuse): (usize, bool),
) -> crate::Result<Flattening> {
    // What each material decides, once: whether it is baked on its objects' meshes and whether it
    // is seen through, from the primitives wearing it.
    let mut by_material: BTreeMap<Option<u64>, Vec<&Part>> = BTreeMap::new();
    for part in parts {
        by_material.entry(part.material).or_default().push(part);
    }
    let kinds: BTreeMap<Option<u64>, (bool, bool)> = by_material
        .iter()
        .map(|(&material, worn)| {
            let seen = seen_through(material, library, maps);
            (material, (on_mesh(worn, library, maps), seen))
        })
        .collect();
    // The entries in the order the primitives first name them: a material and, baked on meshes,
    // the object; each with the primitives it bakes.
    let mut entries: Vec<(Option<u64>, Option<usize>, Vec<usize>)> = Vec::new();
    let mut entry_of: BTreeMap<(Option<u64>, Option<usize>), usize> = BTreeMap::new();
    let mut sets = Vec::with_capacity(parts.len());
    for (k, part) in parts.iter().enumerate() {
        let material = part.material;
        let object = kinds[&material].0.then_some(homes[k].object);
        let at = *entry_of.entry((material, object)).or_insert_with(|| {
            entries.push((material, object, Vec::new()));
            entries.len() - 1
        });
        entries[at].2.push(k);
        sets.push(at as u32);
    }
    // The primitives of each object, its own and the twins reading its bake, in order.
    let mut of_object: BTreeMap<usize, (Vec<usize>, Vec<usize>)> = BTreeMap::new();
    for (k, home) in homes.iter().enumerate() {
        let (own, twins) = of_object.entry(home.object).or_default();
        if home.own {
            own.push(k);
        } else {
            twins.push(k);
        }
    }
    // Each object some entry bakes on: its coordinates, once, per primitive of its own; each
    // primitive that reads its twin's takes the twin's.
    let mut laid: Vec<Option<Vec<[[f64; 2]; 3]>>> = vec![None; parts.len()];
    for &(_, object, _) in &entries {
        let Some(object) = object else { continue };
        let (own, twins) = &of_object[&object];
        if laid[own[0]].is_some() {
            continue;
        }
        let taken: Vec<&Part> = own.iter().map(|&k| &parts[k]).collect();
        for (&k, laid_out) in own.iter().zip(object_coordinates(&taken, reuse)) {
            laid[k] = Some(laid_out);
        }
        // A twin placed mirrored the other way takes its triangles' corners in the other order.
        for &k in twins {
            let twin = own.iter().find(|&&j| parts[j].mesh == parts[k].mesh);
            laid[k] = twin.and_then(|&j| {
                let turned = parts[k].mirrored != parts[j].mirrored;
                let corners = |[a, b, c]: [[f64; 2]; 3]| if turned { [a, c, b] } else { [a, b, c] };
                (laid[j].as_ref()).map(|laid| laid.iter().copied().map(corners).collect())
            });
        }
    }
    // What lies behind the translucent sources seen through: every source, traced once.
    let seen = |m: Option<u64>| kinds[&m].1;
    let behind = (kinds.values().any(|&(_, seen)| seen)).then(|| {
        let pieces: Vec<Piece> = parts.iter().map(|p| p.piece()).collect();
        Behind::of(&pieces, library)
    });
    let mut made = Vec::with_capacity(entries.len());
    for (material, object, members) in &entries {
        check(&library.cancelled)?;
        let Baked {
            base,
            normal,
            metal_rough,
            emission,
            emission_strength,
            ..
        } = match object {
            None => {
                let (sources, coordinates) = quad(*material, library);
                baked(Read::Own(&sources), &coordinates, (side, maps), library)?
            }
            Some(_) => {
                let own: Vec<usize> = (members.iter())
                    .copied()
                    .filter(|&k| homes[k].own)
                    .collect();
                let laid_out: Vec<[[f64; 2]; 3]> = (own.iter())
                    .flat_map(|&k| laid[k].iter().flatten().copied())
                    .collect();
                let behind = behind.as_ref().filter(|_| seen(*material));
                let piece_of = |k: usize| parts[k].piece();
                Read::of(behind, &own, piece_of, library, |read| {
                    baked(read, &laid_out, (side, maps), library)
                })?
            }
        };
        made.push(Flattened {
            base: finished(base),
            normal: normal.map(finished),
            metal_rough: metal_rough.map(finished),
            emission: emission.map(finished),
            strength: emission_strength,
        });
    }
    Ok(Flattening {
        entries: made,
        sets,
        laid,
    })
}
