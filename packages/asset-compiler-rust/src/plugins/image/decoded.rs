//! Ce qu'un pilote d'image rend : les pixels, et ce que le fichier a déclaré autour d'eux.
//!
//! Un pilote ne rend pas qu'une surface. Un fichier déclare aussi des choses que le contrat ne sait
//! pas porter — une animation, un profil colorimétrique, un canal de sélection — et les laisser
//! tomber en silence est le défaut que ce module ferme : ce qui n'est pas converti se compte par une
//! raison nommée, à côté de l'image, sans refuser le décodage.
//!
//! **Alpha droit, partout.** Les deux variantes de `DecodedImage` portent un alpha non prémultiplié.
//! Un format dont les échantillons sont associés à leur alpha — un OpenEXR, dont la spécification
//! dit l'alpha associé, un KTX 2.0 dont le descripteur lève le drapeau prémultiplié — est
//! dé-prémultiplié par son pilote avant de sortir, jamais rendu tel quel : le consommateur ne
//! saurait pas qu'il doit le faire, et l'aperçu prémultiplierait une seconde fois.
use super::DecodedImage;

/// La fonction de transfert des échantillons rendus : la courbe qui relie l'octet stocké à la
/// lumière qu'il représente. Un DDS `_UNORM` et son jumeau `_SRGB` portent les mêmes octets et ne
/// veulent pas dire la même chose ; les confondre éclaircit ou assombrit toute la texture.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transfer {
    /// Les octets sont encodés par la courbe sRGB : ce que déclarent la plupart des formats de
    /// couleur, et ce que la convention prête à ceux qui se taisent.
    Srgb,
    /// Les échantillons sont proportionnels à la lumière. C'est le cas des sorties flottantes, et
    /// celui d'un conteneur GPU qui nomme une variante `_UNORM` ou un `transferFunction` linéaire.
    Linear,
}

/// Ce qu'un pilote rend : l'image, sa fonction de transfert, et les raisons nommées de ce que le
/// fichier déclarait sans que la sortie sache le porter. `notes` n'est jamais un refus — le pilote a
/// rendu une image —, c'est l'appelant qui compte ces raisons au rapport.
pub struct ImageDecoded {
    pub image: DecodedImage,
    pub transfer: Transfer,
    pub notes: Vec<&'static str>,
}

impl ImageDecoded {
    /// Une image décodée et sa fonction de transfert — lue dans le fichier, ou prêtée par la
    /// convention du format (sRGB pour les octets, linéaire pour les flottants) — rien à signaler.
    pub fn new(image: DecodedImage, transfer: Transfer) -> Self {
        Self {
            image,
            transfer,
            notes: Vec::new(),
        }
    }

    /// La même, sa fonction de transfert lue dans le fichier plutôt que prêtée par convention.
    pub fn with_transfer(mut self, transfer: Transfer) -> Self {
        self.transfer = transfer;
        self
    }

    /// Une raison de plus, comptée par l'appelant. Le même code ne s'ajoute qu'une fois : une image
    /// porte un défaut, elle ne le porte pas deux fois.
    pub fn with_note(mut self, note: &'static str) -> Self {
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
        self
    }

    /// Les mêmes, quand l'appelant en a plusieurs à poser d'un coup.
    pub fn with_notes(self, notes: impl IntoIterator<Item = &'static str>) -> Self {
        notes.into_iter().fold(self, Self::with_note)
    }
}
