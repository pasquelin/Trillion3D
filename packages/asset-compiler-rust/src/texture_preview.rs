//! Niveaux progressifs des textures qui alimentent l'atlas couleur.
//!
//! Une texture d'atlas n'arrive qu'après plusieurs images ; en attendant, le moteur échantillonnait
//! du blanc. Le compilateur écrit donc dans le sidecar la queue sans perte de sa chaîne de mips —
//! du niveau dont aucun côté ne dépasse `PREVIEW_BASE` jusqu'au 1×1 — au format exact de la vraie
//! texture : RGBA8 sRGB, alpha droit. Le moteur écrit chaque niveau reçu dans le niveau de mip de
//! même rang de sa couche, borne son échantillonnage au niveau le plus fin résident, puis revient
//! au chemin d'échantillonnage ordinaire dès que la pleine résolution est là et remipmappée.
//!
//! Aucun niveau intermédiaire n'est un fichier : au-dessus de `PREVIEW_BASE`, le niveau suivant est
//! l'image source elle-même, inchangée, que l'hôte charge déjà.
//!
//! Chaîne de calcul, dans cet ordre : décodage → sRGB vers linéaire → prémultiplication par alpha →
//! moyenne de boîte vers le niveau le plus fin porté → chaque niveau suivant par moyenne 2×2 du
//! précédent → pour chaque niveau, dé-prémultiplication au tout dernier pas, linéaire vers sRGB,
//! RGBA8 alpha droit. Le prémultiplié ne vit que dans ce module.
//!
//! Un décodage impossible (DDS, TGA, PNG corrompu, image absente, format inconnu) est une entrée de
//! rapport et aucun niveau : la compilation n'échoue jamais pour une texture, et le moteur retombe
//! sur son blanc.
use super::*;

mod collect;
mod levels;
mod reduce;
mod source;
#[cfg(test)]
mod tests;
pub use levels::*;

/// Contrat de la section : bouger l'échelle des niveaux, leur ordre ou l'espace colorimétrique
/// impose d'incrémenter ce numéro et celui du sidecar binaire qui la transporte.
pub const TEXTURE_PREVIEW_VERSION: u32 = 2;
/// Plus grand côté qu'un niveau porté par le sidecar peut avoir. Le choix borne la section : au plus
/// 21 844 octets par texture, contre les mégaoctets qu'un niveau 256 ou 512 y ajouterait.
pub const PREVIEW_BASE: u32 = 64;
/// Niveaux qu'une entrée porte au plus : 64, 32, 16, 8, 4, 2, 1.
pub const PREVIEW_MAX_LEVELS: u32 = 7;
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

/// Une entrée de la section : la texture qu'elle couvre, sa provenance et les octets de ses niveaux.
/// `first_level` et le nombre de niveaux se redéduisent de `width` et `height` ; les porter dans
/// l'entrée laisse un lecteur refuser une entrée qui ne s'accorde pas avec ses propres dimensions.
pub struct TexturePreview {
    pub texture: u32,
    pub image: u32,
    pub width: u32,
    pub height: u32,
    pub source: PreviewSource,
    pub sha256: String,
    pub first_level: u32,
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
    let pixel_bytes: usize = previews.iter().map(|entry| entry.pixels.len()).sum();
    let report = json!({"version":TEXTURE_PREVIEW_VERSION,"base":PREVIEW_BASE,
        "maxLevels":PREVIEW_MAX_LEVELS,"colorTextures":wanted.len(),"previews":previews.len(),
        "pixelBytes":pixel_bytes,"skipped":skipped});
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
    let (first_level, pixels) = reduce::pyramid(&decoded, entry.cutoff);
    Ok(TexturePreview {
        texture: u32::try_from(entry.texture).map_err(|_| "texture-out-of-bounds")?,
        image: u32::try_from(image_index).map_err(|_| "image-out-of-bounds")?,
        width: decoded.width(),
        height: decoded.height(),
        source: provenance,
        sha256: hash(&bytes),
        first_level,
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
