//! Pilote GIF, lu d'après la spécification publique « Graphics Interchange Format, Version 89a »
//! (CompuServe, 1990) et décodé par la feature `gif` de la crate `image` 0.25.10, qui délègue aux
//! crates `gif` 0.14 et `color_quant` — Rust pur, MIT ou Apache-2.0, notices conservées avec les
//! dépendances. Aucun code ni SDK d'éditeur, aucun réencodage.
//!
//! Le brevet de Unisys sur la compression LZW, qui a fait l'histoire juridique de ce format, a
//! expiré partout en 2004. Note documentaire, pas un avis d'avocat : la politique juridique du
//! dépôt est dans `FORMATS.md`.
//!
//! **Profils lus, tous sans perte vers RGBA8.** Le format est indexé par construction : chaque pixel
//! est un rang dans une table de couleurs, globale ou locale à l'image, et chaque entrée de cette
//! table est déjà du 8-8-8. Porter ces couleurs en RGBA8 les recopie, il n'y a rien à arrondir. La
//! quantification, elle, a eu lieu chez l'encodeur : elle est dans la source, ce pilote n'en ajoute
//! pas. L'index déclaré transparent par une extension de contrôle graphique devient un alpha nul, et
//! sa couleur est conservée telle quelle — ni remplie de blanc, ni prémultipliée.
//!
//! **Une animation est refusée, pas aplatie.** Un fichier qui porte plus d'un descripteur d'image
//! ressort en refus nommé, par la raison d'animation commune aux pilotes : choisir d'office laquelle de
//! ses images est *la* texture serait arbitraire, et une animation n'est pas une texture. Le compte
//! des images ignorées n'est pas publié : le contrat d'image ne nomme une raison que du côté du
//! refus, et le rapport des aperçus ne compte que celles-là.
//!
//! Le parcours des blocs est fait ici, avant tout décodage, parce que le décodeur rendrait sinon la
//! première image d'une animation sans que personne ne l'ait demandé.
use super::crate_image::{self, ANIMATED};
use super::{ImageDecoded, ImageDecoder, Plugin};

pub(super) static GIF: Gif = Gif;
pub(super) struct Gif;

/// L'entête et le descripteur d'écran logique : six octets de signature, la taille sur quatre, le
/// champ groupé, l'index de fond et le rapport d'aspect.
const SCREEN_DESCRIPTOR_END: usize = 13;
/// Le champ groupé du descripteur d'écran, dont le bit haut annonce une table de couleurs globale et
/// les trois bits bas sa taille.
const SCREEN_PACKED_AT: usize = 10;
/// Le bit d'une table de couleurs présente, dans un champ groupé comme dans l'autre.
const COLOR_TABLE_FLAG: u8 = 0b1000_0000;
/// Les trois bits qui donnent la taille d'une table de couleurs.
const COLOR_TABLE_SIZE_MASK: u8 = 0b0000_0111;
/// Introducteur d'un descripteur d'image, et longueur du descripteur qui le suit : position,
/// dimensions et champ groupé.
const IMAGE_SEPARATOR: u8 = 0x2C;
const IMAGE_DESCRIPTOR_BYTES: usize = 9;
/// Introducteur d'une extension, suivi de son étiquette puis de ses sous-blocs.
const EXTENSION_INTRODUCER: u8 = 0x21;
/// Fin du flux : ce qui suit n'appartient plus au format.
const TRAILER: u8 = 0x3B;

impl Plugin for Gif {
    fn name(&self) -> &'static str {
        "gif"
    }
    /// Le suffixe nomme la coupe que ce pilote tient : une seule image, l'animation refusée. Elle
    /// entre dans l'identité du cache parce qu'elle fait partie de ce que le pilote produit.
    fn version(&self) -> &'static str {
        "gif-image-0.25-une-image"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["gif"]
    }
}

impl ImageDecoder for Gif {
    fn mime(&self) -> &'static str {
        "image/gif"
    }
    /// La signature de six octets, dans ses deux versions. La 87a et la 89a partagent la structure
    /// jugée ici : seule la seconde connaît les extensions, que le parcours franchit de toute façon.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a")
    }
    /// Une image, et une seule. Tout le reste — animation, fichier tronqué, table de couleurs
    /// absente — ressort en raison de rapport nommée, jamais en panique ni en échec de compilation.
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        if carries_several_images(bytes) {
            return Err(ANIMATED);
        }
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Gif)
    }
}

/// Parcourt les blocs du flux et dit si un *second* descripteur d'image y apparaît.
///
/// Rien n'est décodé : les sous-blocs de données compressées sont franchis par leurs longueurs, et
/// les extensions — contrôle graphique, commentaire, texte, application — par les leurs. Le parcours
/// s'arrête au premier octet qui manque, et rend alors `false` : un fichier tronqué n'est pas une
/// animation, et c'est au décodeur de le nommer tronqué. Il ne rend `true` que sur une preuve
/// positive : un *second séparateur d'image* réellement lu. Celui-ci suffit, même quand le
/// descripteur qu'il introduit est coupé — le fichier porte alors bien une seconde image, et c'est
/// de l'animation qu'il faut le refuser, pas de sa troncature.
fn carries_several_images(bytes: &[u8]) -> bool {
    let Some(mut at) = after_global_color_table(bytes) else {
        return false;
    };
    let mut seen_image = false;
    while let Some(&block) = bytes.get(at) {
        at += 1;
        match block {
            IMAGE_SEPARATOR => {
                if seen_image {
                    return true;
                }
                seen_image = true;
                let Some(next) = after_image_descriptor(bytes, at) else {
                    return false;
                };
                at = next;
            }
            // L'étiquette de l'extension, puis ses sous-blocs : aucune ne porte de pixels.
            EXTENSION_INTRODUCER => {
                let Some(next) = after_sub_blocks(bytes, at + 1) else {
                    return false;
                };
                at = next;
            }
            TRAILER => return false,
            // Un octet qui n'introduit rien de connu : le flux n'est plus lisible d'ici, et le
            // décodeur le dira mieux que ce parcours.
            _ => return false,
        }
    }
    false
}

/// Le premier octet après le descripteur d'écran logique et, s'il y en a une, la table de couleurs
/// globale qu'il annonce.
fn after_global_color_table(bytes: &[u8]) -> Option<usize> {
    let packed = *bytes.get(SCREEN_PACKED_AT)?;
    Some(SCREEN_DESCRIPTOR_END + color_table_bytes(packed))
}

/// Le premier octet après un descripteur d'image : la table de couleurs locale que son champ groupé
/// annonce parfois, la taille de code initiale, puis ses sous-blocs de données.
fn after_image_descriptor(bytes: &[u8], at: usize) -> Option<usize> {
    // Le champ groupé est le dernier des neuf octets du descripteur, pas celui qui les suit.
    let packed = *bytes.get(at + IMAGE_DESCRIPTOR_BYTES - 1)?;
    let code_size_at = at + IMAGE_DESCRIPTOR_BYTES + color_table_bytes(packed);
    after_sub_blocks(bytes, code_size_at + 1)
}

/// Les octets qu'occupe une table de couleurs d'après le champ groupé qui l'annonce : trois par
/// entrée, et deux puissance la taille déclarée plus un entrées. Zéro quand il n'y en a pas.
fn color_table_bytes(packed: u8) -> usize {
    if packed & COLOR_TABLE_FLAG == 0 {
        return 0;
    }
    3 * (1usize << ((packed & COLOR_TABLE_SIZE_MASK) + 1))
}

/// Le premier octet après une suite de sous-blocs : chacun annoncé par sa longueur sur un octet, la
/// suite close par une longueur nulle. Rend `None` si le fichier s'arrête avant cette clôture.
fn after_sub_blocks(bytes: &[u8], mut at: usize) -> Option<usize> {
    loop {
        let length = *bytes.get(at)? as usize;
        at += 1;
        if length == 0 {
            return Some(at);
        }
        // Le sous-bloc doit être entièrement là : sans cela, la longueur suivante serait lue dans
        // des octets qui n'existent pas, ou pire, dans les données d'un bloc amputé.
        at = at.checked_add(length)?;
        if at > bytes.len() {
            return None;
        }
    }
}
