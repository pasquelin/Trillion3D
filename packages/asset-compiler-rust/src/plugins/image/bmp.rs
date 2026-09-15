//! Pilote BMP (Windows Bitmap, *device-independent bitmap*), lu d'après les structures publiques
//! `BITMAPFILEHEADER`, `BITMAPINFOHEADER` et leurs extensions V2 à V5 documentées par Microsoft
//! (« Bitmap Header Types »), et décodé par la crate `image` (feature `bmp`, MIT ou Apache-2.0,
//! notices conservées avec la dépendance). Aucun code ni SDK d'éditeur, aucun réencodage.
//!
//! **Profils lus, tous sans perte vers RGBA8** : vraies couleurs 24 et 32 bits, palettes 1, 2, 4 et
//! 8 bits, 16 bits par masques (5-5-5 comme 5-6-5), et les deux compressions par plages `BI_RLE8`
//! et `BI_RLE4`, qui sont sans perte par construction. L'ordre des lignes est celui du format : une
//! hauteur positive décrit un fichier bas-haut, que le décodeur remet dans l'ordre de l'image, et
//! une hauteur négative un fichier haut-bas. Un `BI_RGB` 32 bits garde un alpha opaque : la
//! spécification déclare son quatrième octet *inutilisé*, et le lire comme un alpha serait une
//! supposition, pas une lecture.
//!
//! **Pourquoi les moins de huit bits par canal entrent sans perte.** Le décodeur porte chaque canal
//! de `n` bits vers huit par une table `round(v × 255 / (2^n − 1))` — une mise à l'échelle
//! proportionnelle arrondie au plus proche, et non une recopie de bits. Les deux conviennent ici
//! pour la même raison : la table est *strictement croissante*, donc injective, donc inversible —
//! les 32 valeurs d'un canal de 5 bits tombent sur 32 valeurs de 8 bits distinctes, et le chemin
//! retour rend la valeur d'origine. Aucune information de la source n'est perdue.
//!
//! **Ce qui est refusé, et pourquoi.** Un masque de plus de huit bits par canal — ce que les entêtes
//! V4 et V5 autorisent, par exemple en 10-10-10 — serait, lui, tronqué de ses bits de poids faible
//! par le décodeur : c'est une perte, elle est donc écartée avant tout décodage, par un nom. Les
//! compressions qui emballent un autre format (`BI_JPEG`, `BI_PNG`) et celles hors du format lu
//! (`BI_ALPHABITFIELDS`, les variantes CMJN) sont nommées de la même façon.
use super::{crate_image, DecodedImage, ImageDecoder, Plugin};

pub(super) static BMP: Bmp = Bmp;
pub(super) struct Bmp;

/// Une profondeur hors des profils portés sans perte vers RGBA8 : les 64 bits par pixel des entêtes
/// récents, notamment, que le contrat `Rgba8` ne saurait pas porter sans rogner.
const DEPTH: &str = "bmp-depth-unsupported";
/// Un masque de canal plus large que huit bits. Le décodeur le ramènerait à huit en jetant ses bits
/// de poids faible, ce qui ajouterait à la source une perte qu'elle n'avait pas.
const LOSSY_MASKS: &str = "bmp-bitfields-lossy";
/// `BI_JPEG` ou `BI_PNG` : le fichier n'emballe pas des pixels mais un autre format entier. Le
/// routeur d'images désigne un pilote par format ; en déballer un second ici le contournerait.
const EMBEDDED: &str = "bmp-embedded-codec-unsupported";
/// Une compression hors du format lu, `BI_ALPHABITFIELDS` et les variantes CMJN comprises.
const COMPRESSION: &str = "bmp-compression-unsupported";

/// L'entête de fichier : « BM », la taille, deux champs réservés, l'offset des pixels.
const FILE_HEADER_BYTES: usize = 14;
/// La taille de l'entête DIB, premier champ après l'entête de fichier. C'est elle qui dit lequel des
/// six entêtes le fichier porte.
const DIB_SIZE_AT: usize = FILE_HEADER_BYTES;
/// `BITMAPCOREHEADER` : douze octets, et sa profondeur juste après ses dimensions sur deux octets.
const CORE_SIZE: u32 = 12;
const CORE_DEPTH_AT: usize = 24;
/// `BITMAPINFOHEADER` et ses extensions : la profondeur puis la compression, aux mêmes rangs dans
/// les six entêtes — les extensions ajoutent des champs *après* ces deux-là, jamais avant.
const INFO_DEPTH_AT: usize = 28;
const INFO_COMPRESSION_AT: usize = 30;
/// Les masques de canaux, lus au même endroit pour tous les entêtes qui en portent : juste après les
/// quarante octets du `BITMAPINFOHEADER`, que ce soit dans l'entête étendu ou derrière lui.
const MASKS_AT: usize = FILE_HEADER_BYTES + 40;
/// Les entêtes qui portent un masque alpha : V3, V4 et V5. Les deux plus courts n'en ont pas.
const ALPHA_MASK_HEADERS: [u32; 3] = [56, 108, 124];
/// Les profondeurs portées sans perte vers RGBA8.
const DEPTHS: [u16; 7] = [1, 2, 4, 8, 16, 24, 32];

impl Plugin for Bmp {
    fn name(&self) -> &'static str {
        "bmp"
    }
    /// Le suffixe nomme la coupe que ce pilote tient : tout ce qu'il rend est sans perte, masques de
    /// plus de huit bits refusés compris. Elle entre dans l'identité du cache parce qu'elle fait
    /// partie de ce que le pilote produit — sans elle, une entrée écrite par un pilote plus laxiste
    /// serait relue comme juste.
    fn version(&self) -> &'static str {
        "bmp-image-0.25-sans-perte"
    }
    /// `.bmp` est l'extension courante ; `.dib` désigne le même entête sans l'entête de fichier chez
    /// quelques exporteurs, et `.rle` les deux compressions par plages du format.
    fn extensions(&self) -> &'static [&'static str] {
        &["bmp", "dib", "rle"]
    }
}

impl ImageDecoder for Bmp {
    fn mime(&self) -> &'static str {
        "image/bmp"
    }
    /// Les deux octets « BM » de l'entête de fichier, et de quoi porter un entête DIB derrière.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= FILE_HEADER_BYTES + CORE_SIZE as usize && head.starts_with(b"BM")
    }
    /// La coupe d'abord, les pixels ensuite : ce que le décodeur rognerait est écarté *avant* de le
    /// lui tendre, parce qu'après il est trop tard — il rendrait des pixels déjà appauvris sans que
    /// personne ne l'ait demandé. Tout le reste — fichier tronqué, masque non contigu, palette
    /// illisible — ressort en raison de rapport, jamais en panique.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        admitted(bytes)?;
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Bmp)
    }
}

/// Lit l'entête DIB et dit si ce fichier entre sans perte. Un entête trop court pour porter les
/// champs jugés n'est pas refusé ici : il part au décodeur, qui le nomme tronqué comme tout autre.
fn admitted(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    let Some(header) = u32_at(bytes, DIB_SIZE_AT) else {
        return Ok(());
    };
    // `BITMAPCOREHEADER` ne connaît aucune compression : sa seule question est la profondeur.
    let depth_at = if header == CORE_SIZE {
        CORE_DEPTH_AT
    } else {
        INFO_DEPTH_AT
    };
    let Some(depth) = u16_at(bytes, depth_at) else {
        return Ok(());
    };
    if !DEPTHS.contains(&depth) {
        return Err(DEPTH);
    }
    if header == CORE_SIZE {
        return Ok(());
    }
    let Some(compression) = u32_at(bytes, INFO_COMPRESSION_AT) else {
        return Ok(());
    };
    match compression {
        // `BI_RGB`, `BI_RLE8` et `BI_RLE4` : des pixels, crus ou par plages, tous sans perte.
        0..=2 => Ok(()),
        // `BI_BITFIELDS` : les masques disent combien de bits chaque canal porte réellement.
        3 => masks_are_lossless(bytes, header),
        // `BI_JPEG` et `BI_PNG` : un autre format entier, qui a son propre pilote.
        4..=5 => Err(EMBEDDED),
        _ => Err(COMPRESSION),
    }
}

/// Les trois — ou quatre — masques de canaux, chacun contre la largeur que huit bits peuvent porter
/// sans rien jeter. Un masque absent ou nul ne dit rien de faux : le décodeur tranchera lui-même
/// qu'il manque, et le nommera.
fn masks_are_lossless(bytes: &[u8], header: u32) -> std::result::Result<(), &'static str> {
    let channels = if ALPHA_MASK_HEADERS.contains(&header) {
        4
    } else {
        3
    };
    for channel in 0..channels {
        let Some(mask) = u32_at(bytes, MASKS_AT + channel * 4) else {
            return Ok(());
        };
        if mask_width(mask) > 8 {
            return Err(LOSSY_MASKS);
        }
    }
    Ok(())
}

/// Le nombre de bits qu'un masque contigu porte. Un masque troué n'est pas jugé ici — le décodeur le
/// refuse déjà, et lui donner une largeur ici serait la lui inventer : on rend alors zéro, qui
/// n'accuse rien.
fn mask_width(mask: u32) -> u32 {
    if mask == 0 {
        return 0;
    }
    let width = (!(mask >> mask.trailing_zeros())).trailing_zeros();
    if width == mask.count_ones() {
        width
    } else {
        0
    }
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    let field = bytes.get(at..at + 2)?;
    Some(u16::from_le_bytes([field[0], field[1]]))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    let field = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([field[0], field[1], field[2], field[3]]))
}
