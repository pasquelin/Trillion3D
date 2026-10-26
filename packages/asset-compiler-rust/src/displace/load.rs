//! A scene's displacement maps: the height images its meshes' settings name, read from the scene —
//! the texture's image, its sampler's wrap on each axis — when the first primitive that bakes with
//! one asks for it, and shared by every map that names the texture (`HeightImage`), however many
//! meshes name it and whatever their magnitude and centre. A map's displacement is in the
//! centimetres the tessellation works in.
//!
//! The first channel of the image is the height, as its source holds it: a byte, a 16-bit word (a
//! PNG or a TIFF: the words the image drivers keep beside the bytes they round to, or, for a depth
//! they refuse — `image-depth-unsupported`, `plugins/image` —, as the crate decodes it, whole) or
//! a float (an OpenEXR's half floats are exact floats).
use super::bake::Baked;
use super::map::{DisplacementMap, HeightImage, Heights};
use super::settings::{DisplacementSettings, EdgeSplit};
use crate::compiler::accessor::codes::CLAMP_TO_EDGE;
use crate::compiler::validate::OPTIONS;
use crate::plugins::image::DecodedImage;
use crate::simplify::CENTIMETRES;
use crate::texture::binding::{sampler_wrap, texture_image};
use crate::texture::PREVIEW_MAX_ALLOC;
use crate::{CompilerError, Result};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

/// A mesh's maps and how it is tessellated with them.
pub(crate) struct Bake {
    pub maps: Vec<DisplacementMap>,
    pub uv_channel: usize,
    pub edge_split: EdgeSplit,
}

/// The scene, whose images the maps are read from: its glTF, its binary and where relative image
/// URIs resolve.
type Scene<'a> = (&'a Value, &'a [u8], &'a Path);

/// A height image read, none where its size displaces nothing (`HeightImage::new`), or the reason
/// it cannot be read.
type Read = std::result::Result<Option<Arc<HeightImage>>, String>;

/// A mesh once baked: each of its primitives' baked triangles, by the primitive's rank, until the
/// primitive takes them; or the refusal that made it, as its code and its message.
type Made = std::result::Result<Mutex<BTreeMap<usize, Baked>>, (&'static str, String)>;

/// The displacement each source mesh of a scene bakes into its triangles, by the mesh's rank, the
/// images its maps name, each read at the first ask, and the meshes baked, each made by the first
/// of its primitives that asks.
pub(crate) struct Bakes<'a> {
    settings: Vec<Option<&'a DisplacementSettings>>,
    scene: Scene<'a>,
    /// The textures the settings name, each with its image once read.
    images: BTreeMap<usize, OnceLock<Read>>,
    /// The meshes whose settings name a map, each once baked.
    meshes: BTreeMap<usize, OnceLock<Made>>,
}

/// The refusal of a map whose texture `texture` cannot be read, `why` naming what is wrong.
fn unreadable(texture: usize, why: &str) -> CompilerError {
    OPTIONS.bad(format!("displacement map texture {texture} {why}"))
}

/// The entry of glTF texture `texture` and the image it shows: the one the scene's table
/// publishes (`texture_image`).
fn image_of(g: &Value, texture: usize) -> std::result::Result<(&Value, &Value), &'static str> {
    let entry = (g.get("textures").and_then(Value::as_array)).and_then(|all| all.get(texture));
    let entry = entry.ok_or("is not a texture of the scene")?;
    let image = texture_image(entry).and_then(|at| g.get("images")?.as_array()?.get(at as usize));
    Ok((entry, image.ok_or("names no image of the scene")?))
}

/// The heights of the first channel of a 16-bit PNG or TIFF — the grey, or the red —, and its
/// size, none for any other file: the drivers refuse that depth to keep the precision a byte
/// would lose, and a height map is the use that keeps it.
fn sixteen_bit(bytes: &[u8]) -> Option<(Heights, (usize, usize))> {
    use image::DynamicImage as Pixels;
    let format = image::guess_format(bytes).ok();
    let format =
        format.filter(|f| matches!(f, image::ImageFormat::Png | image::ImageFormat::Tiff))?;
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(PREVIEW_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    let size = (decoded.width() as usize, decoded.height() as usize);
    let words: Vec<u16> = match decoded {
        Pixels::ImageLuma16(pixels) => pixels.pixels().map(|p| p.0[0]).collect(),
        Pixels::ImageLumaA16(pixels) => pixels.pixels().map(|p| p.0[0]).collect(),
        Pixels::ImageRgb16(pixels) => pixels.pixels().map(|p| p.0[0]).collect(),
        Pixels::ImageRgba16(pixels) => pixels.pixels().map(|p| p.0[0]).collect(),
        _ => return None,
    };
    Some((Heights::Words(words), size))
}

/// The first channel of the image `bytes` hold, and its size.
fn heights_of(bytes: &[u8]) -> std::result::Result<(Heights, (usize, usize)), &'static str> {
    let decoded = match crate::plugins::image::decode(bytes, PREVIEW_MAX_ALLOC) {
        Ok(decoded) => decoded,
        Err(reason) => return sixteen_bit(bytes).ok_or(reason),
    };
    Ok(match decoded.image {
        DecodedImage::Rgba8(pixels) => {
            let size = (pixels.width() as usize, pixels.height() as usize);
            // A file stored at 16 bits keeps its words beside the bytes they round to.
            let heights = match decoded.wide {
                Some(wide) => {
                    Heights::Words(wide.as_chunks::<4>().0.iter().map(|t| t[0]).collect())
                }
                None => Heights::Bytes(pixels.pixels().map(|p| p.0[0]).collect()),
            };
            (heights, size)
        }
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => {
            let heights = data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|texel| texel[0])
                .collect();
            (Heights::Floats(heights), (width as usize, height as usize))
        }
    })
}

/// The image of glTF texture `texture`, decoded and chained, its axes wrapping as its sampler's
/// do: they do unless the sampler clamps; a texture with no sampler wraps.
fn read((g, bin, image_root): Scene<'_>, texture: usize) -> Read {
    let (entry, image) = image_of(g, texture).map_err(str::to_owned)?;
    let (heights, size) =
        crate::texture::source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            heights_of(bytes)
        })
        .map_err(|reason| format!("cannot be read: {reason}"))?;
    let clamped = Some(u64::from(CLAMP_TO_EDGE));
    let wrap = ["wrapS", "wrapT"].map(|key| sampler_wrap(g, entry, key) != clamped);
    Ok(HeightImage::new(heights, size, wrap))
}

/// The texels of glTF texture `texture`'s image, from its header alone.
fn texels_of(
    (g, bin, image_root): Scene<'_>,
    texture: usize,
) -> std::result::Result<usize, String> {
    let (_, image) = image_of(g, texture).map_err(str::to_owned)?;
    let (width, height) =
        crate::texture::source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
            let decoder = crate::plugins::image::by_head(bytes).ok_or("image-format-unknown")?;
            decoder.dimensions(bytes)
        })
        .map_err(|reason| format!("cannot be read: {reason}"))?;
    Ok(width as usize * height as usize)
}

impl<'a> Bakes<'a> {
    /// The maps of each of `settings`, in order of the meshes' ranks, none for a mesh that bakes
    /// nothing, of the scene `scene`.
    pub(crate) fn new(
        settings: impl IntoIterator<Item = Option<&'a DisplacementSettings>>,
        scene: Scene<'a>,
    ) -> Self {
        let settings: Vec<_> = (settings.into_iter())
            .map(|named| named.filter(|named| !named.is_off()))
            .collect();
        let images = (settings.iter().flatten())
            .flat_map(|named| {
                named
                    .maps
                    .iter()
                    .map(|spec| (spec.texture, OnceLock::new()))
            })
            .collect();
        let meshes = (settings.iter().enumerate())
            .filter(|(_, named)| named.is_some())
            .map(|(mesh, _)| (mesh, OnceLock::new()))
            .collect();
        Self {
            settings,
            scene,
            images,
            meshes,
        }
    }

    /// Whether source mesh `mesh` names height maps its primitives may bake.
    pub(crate) fn names(&self, mesh: usize) -> bool {
        self.settings.get(mesh).is_some_and(Option::is_some)
    }

    /// The texels of each distinct image the meshes' maps name, from the headers.
    pub(crate) fn texels(&self) -> Result<BTreeMap<usize, usize>> {
        (self.images.keys())
            .map(|&texture| {
                let texels = texels_of(self.scene, texture);
                Ok((texture, texels.map_err(|why| unreadable(texture, &why))?))
            })
            .collect()
    }

    /// The textures source mesh `mesh`'s maps name, in order.
    pub(crate) fn textures(&self, mesh: usize) -> Vec<usize> {
        let named = self.settings.get(mesh).copied().flatten();
        named.map_or_else(Vec::new, |named| {
            named.maps.iter().map(|spec| spec.texture).collect()
        })
    }

    /// The image of `texture`, read by the first that asks and shared after it.
    fn image(&self, texture: usize) -> Result<Option<Arc<HeightImage>>> {
        let slot = self.images.get(&texture);
        let slot = slot.expect("a map's texture is among those the settings name");
        let loaded = slot.get_or_init(|| read(self.scene, texture));
        loaded.clone().map_err(|why| unreadable(texture, &why))
    }

    /// Primitive `index` of source mesh `mesh`, baked: its triangles once the mesh is, which the
    /// first primitive of the mesh to ask makes by `make` — every primitive of the mesh, by rank —
    /// and the others wait for; given once, to the primitive that takes it. None for a primitive
    /// `make` left out.
    pub(crate) fn piece(
        &self,
        (mesh, index): (usize, usize),
        make: impl FnOnce() -> Result<BTreeMap<usize, Baked>>,
    ) -> Result<Option<Baked>> {
        let slot = self.meshes.get(&mesh);
        let slot = slot.expect("a mesh that bakes is among those the settings name");
        let made = slot.get_or_init(|| match make() {
            Ok(pieces) => Ok(Mutex::new(pieces)),
            Err(error) => Err((error.code, error.message)),
        });
        match made {
            Ok(pieces) => {
                let mut pieces = pieces.lock().unwrap_or_else(|held| held.into_inner());
                Ok(pieces.remove(&index))
            }
            Err((code, message)) => Err(CompilerError::new(code, message.clone())),
        }
    }

    /// The bake of source mesh `mesh`, none for a mesh that bakes nothing: its maps over their
    /// images, their magnitude brought to centimetres.
    pub(crate) fn of(&self, mesh: usize) -> Result<Option<Bake>> {
        let Some(named) = self.settings.get(mesh).copied().flatten() else {
            return Ok(None);
        };
        let mut maps = Vec::with_capacity(named.maps.len());
        for spec in &named.maps {
            let image = self.image(spec.texture)?;
            let displacement = (spec.magnitude * CENTIMETRES, spec.center);
            maps.push(DisplacementMap::over(image, displacement));
        }
        Ok(Some(Bake {
            maps,
            uv_channel: named.uv_channel,
            edge_split: named.edge_split,
        }))
    }
}
