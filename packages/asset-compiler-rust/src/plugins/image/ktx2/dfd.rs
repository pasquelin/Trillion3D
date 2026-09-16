//! Le descripteur de format d'un KTX 2.0 — le « Khronos Data Format Descriptor » —, et ce qu'il
//! déclare autour des texels.
//!
//! La spécification de Khronos place ce descripteur dans une section que l'entête désigne par un
//! décalage et une longueur. Il ouvre sur sa taille totale, puis sur un bloc de base dont ce module
//! lit `transferFunction` : l'octet qui dit si les échantillons sont encodés par la courbe sRGB ou
//! proportionnels à la lumière. L'ignorer revenait à éclaircir ou assombrir une texture entière.
//!
//! Ce module ne juge rien et ne refuse rien : un descripteur absent, tronqué ou muet rend
//! simplement une déclaration vide, et c'est l'appelant qui décide de ce qu'il en fait.
use crate::plugins::image::Transfer;

/// Les deux mots de l'entête qui désignent la section : son décalage puis sa longueur.
const OFFSET: usize = 48;
const LENGTH: usize = 52;
/// La taille totale du descripteur ouvre la section ; le bloc de base commence juste après.
const TOTAL_SIZE: usize = 4;
/// Dans le bloc de base : la fonction de transfert.
const TRANSFER: usize = 10;

/// `KHR_DF_TRANSFER_LINEAR` et `KHR_DF_TRANSFER_SRGB`. Zéro est `KHR_DF_TRANSFER_UNSPECIFIED`, et
/// toute autre valeur nomme une courbe que ce pilote ne déclare pas : dans les deux cas le fichier
/// n'a rien dit d'utilisable, et l'appelant s'en remet au `vkFormat`.
const LINEAR: u8 = 1;
const SRGB: u8 = 2;
/// Ce que le descripteur déclare. `transfer` est vide quand le fichier n'a pas de descripteur, que
/// celui-ci est tronqué, ou qu'il laisse la fonction de transfert indéterminée.
pub(super) struct Descriptor {
    pub(super) transfer: Option<Transfer>,
}

/// Le descripteur de ce fichier, ou une déclaration vide. Les bornes de la section sont vérifiées
/// contre la longueur du fichier : un décalage qui sort ne lit rien, il ne lit jamais à côté.
pub(super) fn read(bytes: &[u8]) -> Descriptor {
    let byte = |at: usize| basic(bytes).and_then(|block| block.get(at).copied());
    Descriptor {
        transfer: match byte(TRANSFER) {
            Some(LINEAR) => Some(Transfer::Linear),
            Some(SRGB) => Some(Transfer::Srgb),
            _ => None,
        },
    }
}

/// Le bloc de base du descripteur : la section que l'entête désigne, sa taille totale passée.
fn basic(bytes: &[u8]) -> Option<&[u8]> {
    let word = |at: usize| {
        let field: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
        usize::try_from(u32::from_le_bytes(field)).ok()
    };
    let (at, length) = (word(OFFSET)?, word(LENGTH)?);
    bytes.get(at..at.checked_add(length)?)?.get(TOTAL_SIZE..)
}
