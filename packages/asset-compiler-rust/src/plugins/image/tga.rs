//! Pilote TGA (Truevision TARGA), lu depuis la spécification publique « Truevision TGA File Format
//! Specification, Version 2.0 » et décodé par la crate `image` (feature `tga`, MIT ou Apache-2.0,
//! notices conservées avec la dépendance). Aucun SDK d'éditeur, aucun réencodage : le fichier est lu
//! tel quel vers RGBA8, et le canal alpha des 32 bits est conservé octet pour octet.
//!
//! TGA n'a pas de nombre magique en tête : la version 1.0 commence directement par ses dix-huit
//! octets d'entête, et seule la version 2.0 pose un pied « TRUEVISION-XFILE. » en fin de fichier. Le
//! pilote reconnaît donc un TGA de deux façons : son extension, par le registre, puis la structure
//! de son entête — chaque champ dans son domaine et les champs cohérents entre eux. Le pied de la
//! 2.0, quand les octets fournis vont jusque-là, suffit à lui seul.
use super::{crate_image, ImageDecoded, ImageDecoder, Plugin};

pub(super) static TGA: Tga = Tga;
pub(super) struct Tga;

/// Les dix-huit octets d'entête, présents dans toutes les versions du format.
const HEADER_BYTES: usize = 18;
/// La signature du pied de page, propre à la version 2.0 et absente de la 1.0.
const FOOTER_SIGNATURE: &[u8] = b"TRUEVISION-XFILE.";
/// Le pied complet : quatre octets d'offset d'extension, quatre d'offset de développeur, puis la
/// signature et son octet nul de fin.
const FOOTER_BYTES: usize = 26;

impl Plugin for Tga {
    fn name(&self) -> &'static str {
        "tga"
    }
    fn version(&self) -> &'static str {
        "tga-image-0.25"
    }
    /// `.tga` est l'extension courante ; `.tpic` est celle que posent les outils Truevision et
    /// quelques exporteurs, pour le même format et le même entête.
    fn extensions(&self) -> &'static [&'static str] {
        &["tga", "tpic"]
    }
}

impl ImageDecoder for Tga {
    fn mime(&self) -> &'static str {
        "image/x-tga"
    }
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.len() >= HEADER_BYTES && (header_is_coherent(head) || has_footer(head))
    }
    /// Les profils lus sans perte : vraies couleurs 24 et 32 bits, palette 8 bits, niveaux de gris
    /// 8 bits, chacun brut ou compressé RLE, origine haute comme basse. Le 15/16 bits entre en RGB :
    /// son bit d'attribut n'est pas un alpha fiable, la spécification interdit de le lire ainsi.
    /// Tout le reste — fichier tronqué, profondeur hors profil, palette illisible — ressort en
    /// raison de rapport, jamais en panique.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Tga)
    }
}

/// Le pied de la version 2.0, cherché seulement quand les octets fournis contiennent la fin du
/// fichier. Son absence ne prouve rien : une TGA 1.0 valide n'en a pas.
fn has_footer(bytes: &[u8]) -> bool {
    bytes.len() >= FOOTER_BYTES
        && bytes[bytes.len() - FOOTER_BYTES + 8..].starts_with(FOOTER_SIGNATURE)
}

/// L'entête, champ par champ puis champ contre champ. Sa cohérence est la seule marque d'une TGA
/// 1.0 : mieux vaut refuser ici que revendiquer les octets d'un format voisin.
fn header_is_coherent(head: &[u8]) -> bool {
    let map_type = head[1];
    let image_type = head[2];
    let map_length = u16::from_le_bytes([head[5], head[6]]);
    let map_entry_size = head[7];
    let width = u16::from_le_bytes([head[12], head[13]]);
    let height = u16::from_le_bytes([head[14], head[15]]);
    let depth = head[16];
    let descriptor = head[17];
    if map_type > 1 || width == 0 || height == 0 || descriptor & 0b1100_0000 != 0 {
        return false;
    }
    let mapped = matches!(image_type, 1 | 9);
    if mapped != (map_type == 1) {
        return false;
    }
    if mapped {
        // Image à palette : la palette existe, ses entrées ont une taille du format, et les pixels
        // sont des indices d'un ou deux octets qui tiennent dans une entrée.
        return map_length > 0
            && matches!(map_entry_size, 15 | 16 | 24 | 32)
            && matches!(depth, 8 | 16)
            && depth <= map_entry_size;
    }
    // Sans palette, les deux champs de palette sont nuls et la profondeur suit le type d'image.
    if map_length != 0 || map_entry_size != 0 {
        return false;
    }
    match image_type {
        2 | 10 => matches!(depth, 15 | 16 | 24 | 32),
        3 | 11 => depth == 8,
        _ => false,
    }
}
