//! La conversion d'espace, une fois pour toutes.
//!
//! Unity : main gauche, Y en haut, Z vers l'avant, une unité = un mètre. glTF : main droite, Y en
//! haut, Z vers l'observateur, une unité = un mètre. Les deux ne diffèrent que par le sens de Z :
//! la conversion exacte est la symétrie `S = diag(1, 1, -1)`, qui est sa propre inverse.
//!
//! On ne l'applique qu'aux transformations de la scène Unity, jamais aux sommets d'un modèle
//! importé. La raison tient en une ligne : Unity lit elle-même un FBX ou un glTF en appliquant `S`,
//! donc un sommet du modèle vaut `S·v` dans la scène Unity, et repasser en glTF redonne
//! `S·(T₁…Tₙ)·S·v = (S·T₁·S)…(S·Tₙ·S)·v`. La chaîne se télescope : convertir chaque transformation
//! locale par `T ↦ S·T·S` suffit, et la géométrie du modèle reste intacte, dans l'espace où son
//! propre pilote l'a rendue. `S·T·S` est une rotation propre (déterminant +1) : l'ordre
//! d'enroulement des faces ne change pas, aucune normale n'est retournée.
//!
//! Sur une transformation locale Unity (position `p`, quaternion `q`, échelle `s`), cela donne :
//! - position `(x, y, -z)` ;
//! - quaternion `(-x, -y, z, w)` — la symétrie envoie l'axe `a` sur `S·a` et l'angle `θ` sur `-θ` ;
//! - échelle inchangée, puisque `S·diag(s)·S = diag(s)`.
use serde_json::{json, Value};

/// Une transformation locale Unity, déjà convertie dans l'espace glTF.
#[derive(Clone, Copy)]
pub(super) struct Trs {
    pub(super) translation: [f64; 3],
    pub(super) rotation: [f64; 4],
    pub(super) scale: [f64; 3],
}

impl Trs {
    pub(super) const IDENTITY: Trs = Trs {
        translation: [0.0, 0.0, 0.0],
        rotation: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0],
    };
    /// Convertit une transformation locale lue chez Unity.
    pub(super) fn from_unity(position: [f64; 3], rotation: [f64; 4], scale: [f64; 3]) -> Trs {
        // `-0.0` vaut `0.0` mais ne s'écrit pas pareil : on le ramène à zéro pour que deux
        // conversions de la même scène donnent les mêmes octets.
        let flip = |value: f64| if value == 0.0 { 0.0 } else { -value };
        Trs {
            translation: [position[0], position[1], flip(position[2])],
            rotation: [
                flip(rotation[0]),
                flip(rotation[1]),
                rotation[2],
                rotation[3],
            ],
            scale,
        }
    }
    /// Une transformation dont un nombre n'est pas fini ne peut pas entrer dans la scène : le
    /// pilote la compte au rapport et laisse l'identité à sa place.
    pub(super) fn is_finite(&self) -> bool {
        let finite = |values: &[f64]| values.iter().all(|value| value.is_finite());
        let length = self.rotation.iter().map(|v| v * v).sum::<f64>();
        finite(&self.translation) && finite(&self.rotation) && finite(&self.scale) && length > 1e-12
    }
    /// Les champs d'un nœud glTF, omis quand ils valent le défaut du format.
    pub(super) fn write(&self, node: &mut Value) {
        if self.translation != Trs::IDENTITY.translation {
            node["translation"] = json!(self.translation);
        }
        if self.rotation != Trs::IDENTITY.rotation {
            let length = self.rotation.iter().map(|v| v * v).sum::<f64>().sqrt();
            node["rotation"] = json!(self.rotation.map(|value| value / length));
        }
        if self.scale != Trs::IDENTITY.scale {
            node["scale"] = json!(self.scale);
        }
    }
}
