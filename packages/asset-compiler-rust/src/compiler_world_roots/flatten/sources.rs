//! What the bakes read of their sources: every material the HLOD merges, each texture's whole mip
//! chain decoded once from its image — the chain the GPU reads (`texture_preview::reduce`), so a
//! texel of the atlas filters the source over its footprint as the engine would draw it there —,
//! and triangle soups in world space traced with those materials (`surface_trace::Traceable`) — or
//! with an HLOD actor's flattened material, read from its atlas as the scene publishes it
//! (`atlas_surface`).
use crate::plugins::image::DecodedImage;
use crate::surface_trace::mesh::{Corners, SETS};
use crate::surface_trace::surface::{Surface, Texels};
use crate::surface_trace::Traceable;
use crate::texture_preview::{linear_to_srgb, preview_level_size, AtlasKind};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;
use trillion3d_math::scalar::unit_to_byte_f32;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// The source materials, by glTF material, with every texture's chain.
pub(crate) struct Library {
    surfaces: BTreeMap<Option<u64>, Surface>,
}

/// The texture slots of a material the bake reads: base colour, normal map and metal-roughness
/// map, the maps the flattened material carries (`bake.rs`).
const SLOTS: [(&str, AtlasKind); 3] = [
    (
        "/pbrMetallicRoughness/baseColorTexture/index",
        AtlasKind::Color,
    ),
    ("/normalTexture/index", AtlasKind::Data),
    (
        "/pbrMetallicRoughness/metallicRoughnessTexture/index",
        AtlasKind::Data,
    ),
];

impl Library {
    /// The materials `materials` of `g`, each texture's image read from `bin` or under
    /// `image_root` and decoded once by the one image decoder (`plugins::image::decode`), whatever
    /// format it holds (`bytes_of`), as many at once as its allowance less `reserved` admits; a
    /// texture whose image does not decode reads as none, as the engine draws it white.
    pub fn new(
        source: (&Value, &[u8], &Path),
        materials: &BTreeSet<Option<u64>>,
        (o, reserved): (&crate::Options, usize),
    ) -> crate::Result<Self> {
        let g = source.0;
        let mut wanted: BTreeSet<(u64, AtlasKind)> = BTreeSet::new();
        for id in materials.iter().flatten() {
            let Some(material) = g.pointer(&format!("/materials/{id}")) else {
                continue;
            };
            for (pointer, kind) in SLOTS {
                if let Some(texture) = material.pointer(pointer).and_then(Value::as_u64) {
                    wanted.insert((texture, kind));
                }
            }
        }
        // Each kind's textures decoded as many at once as the job admits (`texture_preview::
        // admission::decode_admitted`): the decodes in flight fit the allowance less `reserved`.
        // Each kind once, however many slots read it.
        let kinds: BTreeSet<AtlasKind> = SLOTS.iter().map(|&(_, kind)| kind).collect();
        let mut chains: BTreeMap<(u64, AtlasKind), Arc<Texels>> = BTreeMap::new();
        for kind in kinds {
            let pairs: Vec<(u64, usize)> = (wanted.iter())
                .filter(|(_, k)| *k == kind)
                .filter_map(|&(texture, _)| {
                    let image = g.pointer(&format!("/textures/{texture}/source"))?;
                    Some((texture, image.as_u64()? as usize))
                })
                .collect();
            let images: Vec<usize> = pairs.iter().map(|&(_, image)| image).collect();
            let decoded = crate::texture_preview::admission::decode_admitted(
                o,
                reserved,
                source,
                &images,
                |image| chain_of(source, image, kind),
            )?;
            for ((texture, _), texels) in pairs.iter().zip(decoded) {
                if let Some(texels) = texels {
                    chains.insert((*texture, kind), Arc::new(texels));
                }
            }
        }
        let surfaces = materials
            .iter()
            .map(|&id| {
                let chain = |texture: Option<u64>, atlas: AtlasKind, _: bool| {
                    chains.get(&(texture?, atlas)).cloned()
                };
                (id, Surface::with(g, id, &chain))
            })
            .collect();
        Ok(Self { surfaces })
    }

    /// The surface of material `id`.
    pub fn surface(&self, id: Option<u64>) -> Surface {
        self.surfaces
            .get(&id)
            .cloned()
            .expect("every merged material is in the library")
    }
}

/// The whole chain of image `image` of `source` read as `kind`, decoded once by the one image
/// decoder (`plugins::image::decode`), whatever format it holds (`bytes_of`); `None` when it does
/// not decode, as the engine draws such a texture white.
fn chain_of(
    (g, bin, image_root): (&Value, &[u8], &Path),
    image: usize,
    kind: AtlasKind,
) -> Option<Texels> {
    let image = g.pointer(&format!("/images/{image}"))?;
    let decoded =
        crate::texture_preview::source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            crate::plugins::image::decode(bytes, crate::texture_preview::PREVIEW_MAX_ALLOC)
        })
        .ok()?;
    Some(texels_of(bytes_of(decoded.image, kind)?, kind))
}

/// The whole chain of `rgba` read as `kind` (`texture_preview::reduce`).
fn texels_of(rgba: image::RgbaImage, kind: AtlasKind) -> Texels {
    let (w, h) = rgba.dimensions();
    // The levels the chain reduces; level 0, the image's own texels, moved in rather than copied
    // (`reduce::chain` borrows it).
    let reduced: Vec<Option<Vec<u8>>> = crate::texture_preview::reduce::chain(&rgba, kind)
        .into_iter()
        .map(|bytes| match bytes {
            std::borrow::Cow::Owned(owned) => Some(owned),
            std::borrow::Cow::Borrowed(_) => None,
        })
        .collect();
    let mut raw = Some(rgba.into_raw());
    let levels = (reduced.into_iter().enumerate())
        .map(|(level, bytes)| {
            let (lw, lh) = preview_level_size(w, h, level as u32);
            let bytes = bytes.unwrap_or_else(|| raw.take().unwrap_or_default());
            (lw as usize, lh as usize, bytes)
        })
        .collect();
    Texels::new(levels, kind == AtlasKind::Color)
}

/// The flattened material of an HLOD actor whose atlas is `atlas`, as the scene publishes it
/// (`publish::flattened_material`), each image's whole chain read as the engine reads it: what a
/// merged layer above reads of a child actor wearing it, the child HLOD mesh's own material.
pub(crate) fn atlas_surface(atlas: &super::Atlas) -> Surface {
    let side = atlas.size as u32;
    let chain = |bytes: &[u8], kind: AtlasKind| {
        let rgba = image::RgbaImage::from_raw(side, side, bytes.to_vec())
            .expect("an atlas holds its side squared texels");
        Arc::new(texels_of(rgba, kind))
    };
    let (base, normal, metal_rough) = (
        chain(&atlas.base, AtlasKind::Color),
        chain(&atlas.normal, AtlasKind::Data),
        chain(&atlas.metal_rough, AtlasKind::Data),
    );
    let g = serde_json::json!({
        "materials": [super::publish::flattened_material("", [Some(0), Some(1), Some(2)])],
    });
    Surface::with(&g, Some(0), &|texture, kind, _| match (texture, kind) {
        (Some(0), AtlasKind::Color) => Some(base.clone()),
        (Some(1), AtlasKind::Data) => Some(normal.clone()),
        (Some(2), AtlasKind::Data) => Some(metal_rough.clone()),
        _ => None,
    })
}

/// The bytes the surface of a `size` texels square atlas holds (`atlas_surface`): three RGBA8
/// chains, each a third more than its first level.
pub(crate) fn atlas_surface_bytes(size: usize) -> usize {
    3 * 4 * size * size * 4 / 3
}

/// What a piece of the sources wears: a material of the source scene, or the flattened material
/// of the HLOD actor of that rank — a child HLOD actor merged as it is drawn, its mesh at LOD 0
/// wearing its own material: a layer above merges what the layer below draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Material {
    Source(Option<u64>),
    Actor(usize),
}

/// The decoder's image as the RGBA8 texels a chain is reduced from: bytes as they are; linear
/// floats — what high-dynamic-range formats decode to (`plugins::image::DecodedImage::RgbaF32`) —
/// written as a byte image of `kind` stores them, a colour atlas's colours in sRGB, every other
/// value on the unit interval, so the sampler reads back the same linear value
/// (`Texels::new`).
fn bytes_of(image: DecodedImage, kind: AtlasKind) -> Option<image::RgbaImage> {
    match image {
        DecodedImage::Rgba8(rgba) => Some(rgba),
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => {
            let byte = |(k, &value): (usize, &f32)| {
                if kind == AtlasKind::Color && k % 4 < 3 {
                    linear_to_srgb(value)
                } else {
                    unit_to_byte_f32(value)
                }
            };
            let bytes = data.iter().enumerate().map(byte).collect();
            image::RgbaImage::from_raw(width, height, bytes)
        }
    }
}

/// A piece of the sources in world space: its material, positions, the attributes its vertices
/// carry and its triangles.
pub(crate) struct Piece<'a> {
    pub material: Material,
    pub positions: &'a [f32],
    pub carried: &'a [Attribute],
    pub indices: &'a [u32],
}

/// The `width` floats of vertex `v` of `attribute`, none past its end.
fn value(attribute: &Attribute, v: usize) -> Option<&[f32]> {
    (attribute.values).get(v * attribute.width..(v + 1) * attribute.width)
}

/// `pieces` traced in world space, their triangles in order, each piece's material a surface of
/// `library` or, an actor's flattened material, of `atlases` (`atlas_surface`, by actor rank).
pub(crate) fn traceable(
    pieces: &[Piece],
    (library, atlases): (&Library, &BTreeMap<usize, Surface>),
) -> Traceable {
    let (mut triangles, mut tags, mut corners, mut surfaces) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut ranks: BTreeMap<Material, u32> = BTreeMap::new();
    for piece in pieces {
        let tag = *ranks.entry(piece.material).or_insert_with(|| {
            surfaces.push(match piece.material {
                Material::Source(id) => library.surface(id),
                Material::Actor(rank) => {
                    (atlases.get(&rank).cloned()).expect("every merged actor's atlas is read")
                }
            });
            (surfaces.len() - 1) as u32
        });
        // Each attribute the bake reads, found once per piece.
        let find = |flag: u32| piece.carried.iter().find(|a| a.flag == flag);
        let uvs = [FLAG_UV, FLAG_UV1].map(find);
        let (normals, colours) = (find(FLAG_NORMAL), find(FLAG_COLOR));
        for triangle in piece.indices.as_chunks::<3>().0 {
            let mut corner = Corners::default();
            let mut normal = [0.0f32; 9];
            let mut colour = [1.0f32; 12];
            for (k, &v) in triangle.iter().enumerate() {
                let v = v as usize;
                triangles.extend_from_slice(&piece.positions[v * 3..v * 3 + 3]);
                for (set, uv) in uvs.iter().enumerate().take(SETS) {
                    if let Some(uv) = uv.and_then(|a| value(a, v)) {
                        corner.uv[set][k * 2..k * 2 + 2].copy_from_slice(&uv[..2]);
                    }
                }
                if let Some(n) = normals.and_then(|a| value(a, v)) {
                    normal[k * 3..k * 3 + 3].copy_from_slice(&n[..3]);
                }
                if let Some(c) = colours.and_then(|a| value(a, v)) {
                    let w = c.len().min(4);
                    colour[k * 4..k * 4 + w].copy_from_slice(&c[..w]);
                }
            }
            corner.normals = normals.is_some().then_some(normal);
            corner.colours = colours.is_some().then_some(colour);
            corners.push(corner);
            tags.push(tag);
        }
    }
    Traceable::new(triangles, tags, corners, surfaces)
}
