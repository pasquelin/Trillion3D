//! A mesh's maps: the height images its settings name, read from the scene — the texture's image,
//! its sampler's wrap on each axis — and made displacement maps (`DisplacementMap`), the
//! displacement in the centimetres the tessellation works in. An image is read once however many
//! meshes name it.
use super::map::DisplacementMap;
use super::settings::{DisplacementSettings, EdgeSplit};
use crate::compiler::validate::OPTIONS;
use crate::plugins::image::DecodedImage;
use crate::simplify::CENTIMETRES;
use crate::{CompilerError, Result};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// The sampler wrap that holds the last texel: `CLAMP_TO_EDGE`. Every other wrap, mirrored or
/// repeated, wraps.
const CLAMP_TO_EDGE: u64 = 33071;

/// A mesh's maps and how it is tessellated with them.
pub(crate) struct Bake {
    pub maps: Vec<DisplacementMap>,
    pub uv_channel: usize,
    pub edge_split: EdgeSplit,
}

/// A height image: each texel's first channel, row by row from the top, its size, and whether each
/// axis wraps.
struct Texels {
    heights: Vec<f32>,
    size: (usize, usize),
    wrap: [bool; 2],
}

/// The refusal of a map whose texture `texture` cannot be read, `why` naming what is wrong.
fn unreadable(texture: usize, why: &str) -> CompilerError {
    OPTIONS.bad(format!("displacement map texture {texture} {why}"))
}

/// Whether the sampler of `texture` wraps along `key` (`wrapS`, `wrapT`): it does unless the
/// sampler clamps; a texture with no sampler wraps.
fn wraps(g: &Value, texture: &Value, key: &str) -> bool {
    let sampler = texture.get("sampler").and_then(Value::as_u64);
    let sampler = sampler.and_then(|at| g.get("samplers")?.as_array()?.get(at as usize));
    sampler.and_then(|s| s.get(key)?.as_u64()) != Some(CLAMP_TO_EDGE)
}

/// The image of glTF texture `texture`, decoded: the first channel of its texels.
fn texels(g: &Value, bin: &[u8], image_root: &Path, texture: usize) -> Result<Texels> {
    let entry = (g.get("textures").and_then(Value::as_array)).and_then(|all| all.get(texture));
    let entry = entry.ok_or_else(|| unreadable(texture, "is not a texture of the scene"))?;
    let source = entry.get("source").and_then(Value::as_u64);
    let image = source.and_then(|at| g.get("images")?.as_array()?.get(at as usize));
    let image = image.ok_or_else(|| unreadable(texture, "names no image of the scene"))?;
    let decoded =
        crate::texture::source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            crate::plugins::image::decode(bytes, crate::texture::PREVIEW_MAX_ALLOC)
        })
        .map_err(|reason| unreadable(texture, &format!("cannot be read: {reason}")))?;
    let (heights, size) = match decoded.image {
        DecodedImage::Rgba8(pixels) => {
            let size = (pixels.width() as usize, pixels.height() as usize);
            let heights = pixels.pixels().map(|p| f32::from(p.0[0]) / 255.0).collect();
            (heights, size)
        }
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => {
            let heights = data.chunks_exact(4).map(|texel| texel[0]).collect();
            (heights, (width as usize, height as usize))
        }
    };
    let wrap = [wraps(g, entry, "wrapS"), wraps(g, entry, "wrapT")];
    Ok(Texels {
        heights,
        size,
        wrap,
    })
}

/// The bake of each of `settings`, in order, none for a mesh that is none: the maps its
/// settings name read from the scene `g` (its binary `bin`, its images under `image_root`), their
/// magnitude brought to centimetres.
pub(crate) fn load_bakes<'a>(
    settings: impl IntoIterator<Item = Option<&'a DisplacementSettings>>,
    (g, bin, image_root): (&Value, &[u8], &Path),
) -> Result<Vec<Option<Bake>>> {
    let mut read: BTreeMap<usize, Texels> = BTreeMap::new();
    let mut bakes = Vec::new();
    for named in settings {
        let Some(named) = named.filter(|named| !named.is_off()) else {
            bakes.push(None);
            continue;
        };
        let mut maps = Vec::with_capacity(named.maps.len());
        for spec in &named.maps {
            if !read.contains_key(&spec.texture) {
                read.insert(spec.texture, texels(g, bin, image_root, spec.texture)?);
            }
            let image = &read[&spec.texture];
            maps.push(DisplacementMap::new(
                image.heights.clone(),
                image.size,
                (spec.magnitude * CENTIMETRES, spec.center),
                image.wrap,
            ));
        }
        bakes.push(Some(Bake {
            maps,
            uv_channel: named.uv_channel,
            edge_split: named.edge_split,
        }));
    }
    Ok(bakes)
}
