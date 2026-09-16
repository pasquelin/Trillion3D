//! Pilote OpenEXR, lu depuis les spécifications publiques de l'Academy Software Foundation
//! (« Technical Introduction to OpenEXR » et « OpenEXR File Layout », openexr.com) pour le champ de
//! version et le jeu de canaux, et décodé par la caisse `exr` 1.74.2 (BSD-3-Clause,
//! `johannesvollmer/exrs`, Rust pur et sans `unsafe`, notices conservées avec la dépendance).
//! Aucun SDK ni code d'éditeur, aucune bibliothèque C, aucun réencodage.
//!
//! **On n'ajoute aucune perte.** Les échantillons sortent en `f32` : un demi-flottant s'y étend
//! exactement, un simple flottant y passe tel quel. Rien n'est ramené à huit bits, rien n'est
//! reporté en tons, rien n'est remis à l'échelle — d'où la variante `DecodedImage::RgbaF32`.
//!
//! **Sous-ensemble accepté**, déclaré ici et nulle part ailleurs : une seule partie, plate (non
//! profonde), à son plus grand niveau de résolution, avec les canaux `R`, `G`, `B` et, s'il y en a
//! un, `A` — en demi ou simple précision, sans sous-échantillonnage. Les canaux sont lus par leur
//! nom, jamais par leur rang. Ce qui sort de là est un refus nommé : parties profondes, fichiers
//! multi-parties, canaux absents, canaux d'un autre nom (AOV, `Y`/`RY`/`BY`, profondeur), entiers
//! 32 bits, chroma sous-échantillonnée. Un fichier hors sous-ensemble laisse le moteur retomber sur
//! son blanc ; il n'est jamais deviné ni approché.
use super::{float_budget, DecodedImage, ImageDecoded, ImageDecoder, Plugin};
use ::exr::image::RgbaChannels;
use ::exr::math::Vec2;
use ::exr::meta::attribute::SampleType;
use ::exr::meta::MetaData;
use ::exr::prelude::traits::{read, ReadChannels, ReadLayers};

pub(super) static EXR: Exr = Exr;
pub(super) struct Exr;

/// Le nombre magique de quatre octets, entier 20 000 630 écrit en petit-boutien.
const MAGIC: &[u8] = &[0x76, 0x2f, 0x31, 0x01];
/// Le champ de version, quatre octets juste après le nombre magique : un numéro de version dans
/// l'octet de poids faible, des drapeaux au-dessus.
const VERSION_FIELD: std::ops::Range<usize> = 4..8;
/// Drapeau « le fichier contient au moins une partie qui n'est pas une image plate », c'est-à-dire
/// des données profondes.
const FLAG_DEEP: u32 = 0x0800;
/// Drapeau « le fichier contient plusieurs parties ».
const FLAG_MULTI_PART: u32 = 0x1000;

/// Entête absent, tronqué ou incohérent : pour l'hôte, c'est le symptôme d'un décodage manqué.
const HEADER_INVALID: &str = "exr-header-invalid";
/// Des données profondes : un pixel y porte une liste d'échantillons, pas une couleur. Les aplatir
/// demanderait une composition, donc un choix que le compilateur n'a pas à faire.
const DEEP: &str = "exr-deep-unsupported";
/// Plusieurs parties : rien ne dit laquelle est la texture. On refuse plutôt que de choisir.
const MULTI_PART: &str = "exr-multipart-unsupported";
/// Le jeu de canaux n'est pas celui qu'un pilote d'image sait rendre.
const CHANNELS: &str = "exr-channels-unsupported";
/// L'image dépasse le plafond d'allocation reçu : un refus, jamais une allocation tentée.
const TOO_LARGE: &str = "exr-image-too-large";
/// L'entête est dans le sous-ensemble, mais les pixels ne se relisent pas : fichier coupé,
/// compression inattendue, table de morceaux fausse.
const UNREADABLE: &str = "exr-data-unreadable";

impl Plugin for Exr {
    fn name(&self) -> &'static str {
        "exr"
    }
    fn version(&self) -> &'static str {
        "exr-openexr-2.0-exrs-1.74.2"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["exr"]
    }
}

impl ImageDecoder for Exr {
    fn mime(&self) -> &'static str {
        "image/x-exr"
    }
    /// Le nombre magique suffit : il n'appartient qu'à ce format. Ce que l'entête annonce ensuite se
    /// vérifie au décodage, où cela se rapporte au lieu de faire taire le pilote.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(MAGIC)
    }
    /// L'entête d'abord, les pixels ensuite : un fichier hors sous-ensemble ne va jamais jusqu'au
    /// décodeur, et la taille est connue — donc le plafond appliqué — avant la moindre allocation.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let (width, height) = subset(bytes, max_alloc)?;
        pixels(bytes, width, height)
    }
}

/// Le sous-ensemble accepté, vérifié sur le champ de version puis sur l'entête, et la taille du
/// calque qui en ressort. Les deux drapeaux se lisent sans la caisse : quatre octets de la
/// spécification, et un fichier profond ou multi-parties est nommé avant toute autre lecture.
fn subset(bytes: &[u8], max_alloc: u64) -> std::result::Result<(u32, u32), &'static str> {
    let field: [u8; 4] = bytes
        .get(VERSION_FIELD)
        .and_then(|field| field.try_into().ok())
        .ok_or(HEADER_INVALID)?;
    let flags = u32::from_le_bytes(field);
    if flags & FLAG_DEEP != 0 {
        return Err(DEEP);
    }
    if flags & FLAG_MULTI_PART != 0 {
        return Err(MULTI_PART);
    }
    let meta = MetaData::read_from_buffered(bytes, false).map_err(|_| HEADER_INVALID)?;
    let [header] = &meta.headers[..] else {
        return Err(MULTI_PART);
    };
    if header.deep {
        return Err(DEEP);
    }
    channels(header)?;
    let width = u32::try_from(header.layer_size.width()).map_err(|_| TOO_LARGE)?;
    let height = u32::try_from(header.layer_size.height()).map_err(|_| TOO_LARGE)?;
    float_budget(width, height, max_alloc, TOO_LARGE)?;
    Ok((width, height))
}

/// Les canaux, par leur nom : exactement `R`, `G`, `B`, et au plus un `A`. Un canal de plus — une
/// passe de rendu, une profondeur, une luminance — rend le fichier ambigu : lequel est la couleur,
/// et que deviennent les autres ? On refuse plutôt que d'en jeter en silence.
fn channels(header: &::exr::meta::header::Header) -> std::result::Result<(), &'static str> {
    let mut seen = [false; 3];
    for channel in &header.channels.list {
        match channel.name.to_string().as_str() {
            "R" => seen[0] = true,
            "G" => seen[1] = true,
            "B" => seen[2] = true,
            "A" => {}
            _ => return Err(CHANNELS),
        }
        // Un canal sous-échantillonné n'a pas un échantillon par pixel : le remonter à la pleine
        // résolution serait une interpolation, donc une image que la source ne contient pas.
        if channel.sampling != Vec2(1, 1) {
            return Err(CHANNELS);
        }
        // Les entiers 32 bits ne sont pas des couleurs : la spécification les réserve aux
        // identifiants et aux masques, qu'aucune conversion en flottant ne représente.
        if channel.sample_type == SampleType::U32 {
            return Err(CHANNELS);
        }
    }
    if seen.iter().all(|found| *found) {
        Ok(())
    } else {
        Err(CHANNELS)
    }
}

/// Les pixels du seul calque, à son plus grand niveau de résolution, rangés ligne du haut d'abord.
/// Un fichier sans canal `A` rend un alpha opaque, comme le prescrit la spécification. La lecture
/// est séquentielle : le compilateur borne ses propres fils, un décodeur de texture ne lui en prend
/// pas d'autres dans le dos.
fn pixels(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> std::result::Result<ImageDecoded, &'static str> {
    let stride = width as usize;
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .rgba_channels(
            move |size: Vec2<usize>, _: &RgbaChannels| vec![0.0_f32; size.area() * 4],
            move |data: &mut Vec<f32>, at: Vec2<usize>, (r, g, b, a): (f32, f32, f32, f32)| {
                let base = (at.y() * stride + at.x()) * 4;
                if let Some(pixel) = data.get_mut(base..base + 4) {
                    pixel.copy_from_slice(&[r, g, b, a]);
                }
            },
        )
        .first_valid_layer()
        .all_attributes()
        .non_parallel()
        .from_buffered(std::io::Cursor::new(bytes))
        .map_err(|_| UNREADABLE)?;
    let data = image.layer_data.channel_data.pixels;
    if data.len() != stride * height as usize * 4 {
        return Err(UNREADABLE);
    }
    Ok(ImageDecoded::linear(DecodedImage::RgbaF32 {
        width,
        height,
        data,
    }))
}
