//! Une image décodée, ses chaînes cuites et ses fichiers écrits. Ce module sait ce qu'il décode et
//! où il l'écrit ; il ne sait pas ce qu'est une découpe, et reçoit la liste des textures à mesurer.
use super::collect::AtlasTexture;
use super::reduce::AtlasKind;
use super::*;
use crate::plugins::image::DecodedImage;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};

/// Où les niveaux d'une image vivent dans le cache, relativement à `native/` : un dossier par
/// version de la règle de réduction, puis un par empreinte, un fichier par atlas et par niveau. La
/// version est dans le chemin parce qu'un fichier déjà là n'est jamais réécrit : sans elle, une
/// règle qui change laisserait servir des niveaux calculés par l'ancienne.
pub const TEXTURE_DIR: &str = "textures";
pub fn texture_version_dir() -> String {
    format!("{TEXTURE_DIR}/v{TEXTURE_PREVIEW_VERSION}")
}

/// Ce qu'une image rend une fois cuite : une entrée par (texture, atlas) qui la lit.
pub(super) struct Baked {
    pub previews: Vec<TexturePreview>,
    /// La forme de l'alpha, mesurée une fois, rendue pour CHAQUE texture candidate qui lit l'image :
    /// la feuille des découpes pèse par texture, et une texture sans mesure n'y est pas candidate.
    pub shapes: Vec<(usize, crate::cutout::AlphaShape)>,
    pub notes: Vec<&'static str>,
}

/// Décode une image, mesure son alpha si une texture le demande, cuit une chaîne par atlas qui la
/// lit, écrit les niveaux au-dessus de la queue du sidecar. Un échec vaut pour toutes les textures
/// de l'image, et le rapport les compte toutes.
pub(super) fn one_image(
    inputs: &PreviewInputs<'_>,
    images: &[Value],
    image_index: usize,
    readers: &[AtlasTexture],
) -> std::result::Result<Baked, (&'static str, usize)> {
    let count = readers.len();
    let fail = |reason: &'static str| (reason, count);
    let image = images.get(image_index).ok_or(fail("image-out-of-bounds"))?;
    let (bytes, provenance) = source::image_bytes(inputs, image).map_err(fail)?;
    let (decoded, mut notes) = {
        let _t = perf::Timer::new(perf::Phase::TextureDecode);
        let source = crate::plugins::image::decode(&bytes, PREVIEW_MAX_ALLOC).map_err(fail)?;
        match source.image {
            DecodedImage::Rgba8(pixels) => (pixels, source.notes),
            // Une chaîne est du RGBA8, le format exact de l'atlas. Y faire entrer une image
            // flottante demanderait un report de tons, une perte que la source n'avait pas : la
            // texture est nommée au rapport et n'a pas de chaîne, jamais rognée.
            DecodedImage::RgbaF32 { .. } => return Err(fail("image-float-unsupported")),
        }
    };
    // La mesure de l'alpha lit l'image PLEINE RÉSOLUTION : la largeur d'un bord adouci se compte
    // en pixels de la source, et un niveau réduit la diviserait par son échelle. Une image est
    // mesurée une fois, pour la première texture candidate qui la cite.
    let candidates: Vec<usize> = readers
        .iter()
        .filter(|r| inputs.to_measure.contains(&r.texture))
        .map(|r| r.texture)
        .collect();
    let shapes = if candidates.is_empty() {
        Vec::new()
    } else {
        let _t = perf::Timer::new(perf::Phase::TextureAlpha);
        let shape = crate::cutout::measure(&decoded);
        candidates.into_iter().map(|t| (t, shape.clone())).collect()
    };
    let sha256 = hash(&bytes);
    let (width, height) = (decoded.width(), decoded.height());
    let first_level = preview_first_level(width, height);
    let mut previews = Vec::with_capacity(count);
    for kind in [AtlasKind::Color, AtlasKind::Data] {
        if !readers.iter().any(|r| r.kind == kind) {
            continue;
        }
        let levels = {
            let _t = perf::Timer::new(perf::Phase::TextureBake);
            reduce::chain(&decoded, kind)
        };
        // Un fichier qui ne s'écrit pas — disque plein, dossier interdit — ne coûte pas la queue :
        // l'entrée sort sans niveau cuit, le moteur charge l'image source, et le rapport le dit.
        let baked_levels = match write_levels(inputs.o, &sha256, kind, &levels, (width, height)) {
            Ok(written) => written,
            Err(_) => {
                const NOTE: &str = "texture-level-write-failed";
                if !notes.contains(&NOTE) {
                    notes.push(NOTE);
                }
                0
            }
        };
        let pixels = reduce::tail(&levels, first_level);
        for reader in readers.iter().filter(|r| r.kind == kind) {
            previews.push(TexturePreview {
                texture: u32::try_from(reader.texture)
                    .map_err(|_| fail("texture-out-of-bounds"))?,
                image: u32::try_from(image_index).map_err(|_| fail("image-out-of-bounds"))?,
                width,
                height,
                source: provenance,
                sha256: sha256.clone(),
                kind,
                first_level,
                baked_levels,
                pixels: pixels.clone(),
            });
        }
    }
    Ok(Baked {
        previews,
        shapes,
        notes,
    })
}

/// Le fichier d'un niveau, relativement à `native/` : le gabarit publié au manifeste, rempli.
/// Une seule vérité, la même que le moteur applique de son côté.
pub fn level_path(sha256: &str, kind: AtlasKind, level: u32) -> String {
    level_template()
        .replace("{sha}", sha256)
        .replace("{kind}", kind.name())
        .replace("{level}", &level.to_string())
}

/// Écrit les niveaux au-dessus de la queue du sidecar en PNG, sans perte, un fichier par niveau,
/// et rend combien en existent à la fin. Un fichier déjà là est laissé tel quel : l'empreinte des
/// octets sources et l'atlas suffisent à dire que son contenu est le bon, et le réécrire coûterait
/// la compression d'un 2048² à chaque compilation d'une scène qui partage l'image.
fn write_levels(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    levels: &[Vec<u8>],
    (width, height): (u32, u32),
) -> Result<u32> {
    let native = o.cache.join("native");
    let first = preview_first_level(width, height);
    for (level, pixels) in levels.iter().enumerate().take(first as usize) {
        let path = native.join(level_path(sha256, kind, level as u32));
        if path.exists() {
            continue;
        }
        let (w, h) = preview_level_size(width, height, level as u32);
        let _t = perf::Timer::new(perf::Phase::TextureWrite);
        let mut encoded = Vec::with_capacity(pixels.len() / 2);
        PngEncoder::new_with_quality(&mut encoded, CompressionType::Default, FilterType::Adaptive)
            .write_image(pixels, w, h, ExtendedColorType::Rgba8)
            .map_err(|e| CompilerError::new("TEXTURE_ENCODE_FAILED", e.to_string()))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic(&path, &encoded)?;
    }
    Ok(first)
}

/// Le rapport de l'étape, qui compte ce qu'il a cuit et ce qu'il a refusé.
pub(super) fn report(
    wanted: &[AtlasTexture],
    previews: &[TexturePreview],
    skipped: &BTreeMap<&'static str, usize>,
    notes: &BTreeMap<&'static str, usize>,
) -> Value {
    let pixel_bytes: usize = previews.iter().map(|entry| entry.pixels.len()).sum();
    let baked: u32 = previews.iter().map(|entry| entry.baked_levels).sum();
    json!({"version":TEXTURE_PREVIEW_VERSION,"base":PREVIEW_BASE,"maxLevels":PREVIEW_MAX_LEVELS,
        "colorTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Color).count(),
        "dataTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Data).count(),
        "previews":previews.len(),"pixelBytes":pixel_bytes,"bakedLevels":baked,
        "skipped":skipped,"notes":notes})
}
