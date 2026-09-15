//! Aperçus 16×16 des textures qui alimentent l'atlas couleur.
//!
//! Une texture d'atlas n'arrive qu'après plusieurs images ; en attendant, le moteur échantillonnait
//! du blanc. Le compilateur écrit donc dans le sidecar une pyramide minuscule 16×16 → 1×1 par
//! texture couleur, au format exact de la vraie texture : RGBA8 sRGB, alpha droit. Le moteur la lit
//! tant que le bit « prêt » de sa couche est à zéro, puis bascule sur la vraie texture, inchangée.
//!
//! Chaîne de calcul, dans cet ordre : décodage → sRGB vers linéaire → prémultiplication par alpha →
//! moyenne de boîte vers 16×16 → chaque niveau suivant par moyenne 2×2 du précédent → pour chaque
//! niveau, dé-prémultiplication au tout dernier pas, linéaire vers sRGB, RGBA8 alpha droit. Le
//! prémultiplié ne vit que dans ce module.
//!
//! Un décodage impossible (DDS, TGA, PNG corrompu, image absente, format inconnu) est une entrée de
//! rapport et aucun aperçu : la compilation n'échoue jamais pour une texture, et le moteur retombe
//! sur son blanc.
use super::*;

mod collect;
mod reduce;
mod source;
#[cfg(test)]
mod tests;

/// Contrat de la section : bouger la pyramide, l'ordre des niveaux ou l'espace colorimétrique
/// impose d'incrémenter ce numéro et celui du sidecar binaire qui la transporte.
pub const TEXTURE_PREVIEW_VERSION: u32 = 1;
/// Côté du plus grand niveau. Les suivants sont ses moitiés successives jusqu'à 1×1.
pub const PREVIEW_BASE: u32 = 16;
pub const PREVIEW_LEVELS: usize = 5;
pub const PREVIEW_LEVEL_SIZES: [u32; PREVIEW_LEVELS] = [16, 8, 4, 2, 1];
/// Décalages en octets des cinq niveaux dans les pixels d'une entrée, et leur longueur totale.
pub const PREVIEW_LEVEL_OFFSETS: [u32; PREVIEW_LEVELS] = [0, 1024, 1280, 1344, 1360];
pub const PREVIEW_BYTES: usize = 1364;
/// Plafond d'allocation d'un décodage. Une image plus grande est une entrée de rapport, pas un échec.
const PREVIEW_MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// D'où viennent les octets sources d'un aperçu. L'`uri` elle-même n'est pas recopiée : elle se lit
/// dans `source.gltf` à `images[image]`, que cette entrée nomme.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PreviewSource {
    Uri,
    BufferView(u32),
}
impl PreviewSource {
    pub fn kind(self) -> u32 {
        match self {
            Self::Uri => 0,
            Self::BufferView(_) => 1,
        }
    }
    pub fn buffer_view(self) -> u32 {
        match self {
            Self::Uri => u32::MAX,
            Self::BufferView(view) => view,
        }
    }
}

/// Une entrée de la section : la texture qu'elle couvre, sa provenance et ses 1364 octets de pixels.
pub struct TexturePreview {
    pub texture: u32,
    pub image: u32,
    pub width: u32,
    pub height: u32,
    pub source: PreviewSource,
    pub sha256: String,
    pub pixels: Vec<u8>,
}

/// Tout ce que l'étape lit. `view_map` traduit les vues du glTF d'entrée vers celles écrites dans
/// `source.gltf`, pour que la provenance nomme l'index que le moteur voit.
pub(super) struct PreviewInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub source_dir: &'a Path,
    pub meshes: &'a BTreeSet<usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
}

/// Calcule la pyramide de chaque texture couleur des maillages retenus. Rend les entrées triées par
/// index de texture et le rapport de l'étape.
pub(super) fn stage_texture_previews(
    inputs: &PreviewInputs<'_>,
) -> Result<(Vec<TexturePreview>, Value)> {
    let wanted = collect::color_textures(inputs.g, inputs.meshes)?;
    let textures = inputs.g.get("textures").and_then(Value::as_array);
    let images = inputs.g.get("images").and_then(Value::as_array);
    let mut previews = Vec::new();
    let mut skipped: BTreeMap<&'static str, usize> = BTreeMap::new();
    for entry in &wanted {
        check(inputs.o)?;
        let (Some(textures), Some(images)) = (textures, images) else {
            *skipped.entry("texture-table-absent").or_default() += 1;
            continue;
        };
        match one_preview(inputs, textures, images, entry) {
            Ok(preview) => previews.push(preview),
            Err(reason) => *skipped.entry(reason).or_default() += 1,
        }
    }
    let report = json!({"version":TEXTURE_PREVIEW_VERSION,"levels":PREVIEW_LEVEL_SIZES,
        "colorTextures":wanted.len(),"previews":previews.len(),"skipped":skipped});
    Ok((previews, report))
}

fn one_preview(
    inputs: &PreviewInputs<'_>,
    textures: &[Value],
    images: &[Value],
    entry: &collect::ColorTexture,
) -> std::result::Result<TexturePreview, &'static str> {
    let texture = textures.get(entry.texture).ok_or("texture-out-of-bounds")?;
    let image_index = texture
        .get("source")
        .and_then(Value::as_u64)
        .ok_or("texture-without-image")? as usize;
    let image = images.get(image_index).ok_or("image-out-of-bounds")?;
    let (bytes, provenance) = source::image_bytes(inputs, image)?;
    let decoded = decode(&bytes)?;
    let pixels = reduce::pyramid(&decoded, entry.cutoff);
    Ok(TexturePreview {
        texture: u32::try_from(entry.texture).map_err(|_| "texture-out-of-bounds")?,
        image: u32::try_from(image_index).map_err(|_| "image-out-of-bounds")?,
        width: decoded.width(),
        height: decoded.height(),
        source: provenance,
        sha256: hash(&bytes),
        pixels,
    })
}

/// Décode PNG et JPEG sous un plafond d'allocation. Tout le reste — DDS, TGA, octets corrompus,
/// format inconnu — ressort en raison de rapport.
fn decode(bytes: &[u8]) -> std::result::Result<image::RgbaImage, &'static str> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "image-format-unknown")?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(PREVIEW_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| "image-decode-failed")?;
    if decoded.width() == 0 || decoded.height() == 0 {
        return Err("image-empty");
    }
    Ok(decoded.to_rgba8())
}
