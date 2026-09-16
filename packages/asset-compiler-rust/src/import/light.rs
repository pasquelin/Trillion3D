//! La lampe que tous les pilotes écrivent, quel que soit le format lu.
//!
//! Le seul contrat de lampe que le compilateur sache relire est `KHR_lights_punctual` : une entrée
//! dans `extensions.KHR_lights_punctual.lights`, et un nœud qui la cite. Chaque pilote lit sa
//! propre source — un `ufbx::Light`, un prim `UsdLux`, un bloc `Lamp` de la SDNA — et n'a plus
//! qu'à remplir cette structure : le glTF s'écrit ici, une seule fois, pour qu'un format de plus ne
//! réinvente pas la forme du document.
//!
//! **Unités.** `intensity` est photométrique, comme le glTF l'exige : des candelas pour une
//! ponctuelle et un projecteur, des lux pour une directionnelle. C'est au pilote de convertir
//! l'unité de son format, et de dire laquelle ; `compiler_lights` redivise ensuite par
//! `LUMENS_PER_WATT`. `emitter_radius` est en mètres du monde, comme le reste de la scène.
use super::*;

/// Une lampe lue dans une source, avant qu'elle ne devienne du glTF.
pub(crate) struct LightSource {
    pub(crate) name: String,
    /// `point`, `directional` ou `spot` : les trois seuls types de `KHR_lights_punctual`.
    pub(crate) kind: &'static str,
    pub(crate) colour: [f64; 3],
    /// Candelas pour une ponctuelle et un projecteur, lux pour une directionnelle.
    pub(crate) intensity: f64,
    /// Les demi-angles intérieur et extérieur d'un projecteur, en radians.
    pub(crate) cone: Option<(f64, f64)>,
    /// Le drapeau d'ombre des formats qui en portent un ; absent quand la source n'en dit rien, et
    /// le compilateur laisse alors la lampe projeter son ombre.
    pub(crate) casts_shadow: Option<bool>,
    /// Le rayon de l'enveloppe émissive que la source déclare, en mètres du monde.
    pub(crate) emitter_radius: Option<f64>,
}

impl LightSource {
    /// L'entrée `KHR_lights_punctual` de cette lampe. Ce que la source ne porte pas reste absent :
    /// aucun champ n'est inventé à sa place.
    pub(crate) fn json(&self) -> Value {
        let mut light = json!({
            "name": self.name, "type": self.kind,
            "color": self.colour, "intensity": self.intensity,
        });
        if let Some((inner, outer)) = self.cone {
            light["spot"] = json!({"innerConeAngle": inner, "outerConeAngle": outer});
        }
        let mut extras = serde_json::Map::new();
        if let Some(shadow) = self.casts_shadow {
            extras.insert("castsShadow".into(), json!(shadow));
        }
        if let Some(radius) = self.emitter_radius {
            extras.insert("emitterRadius".into(), json!(radius));
        }
        if !extras.is_empty() {
            light["extras"] = Value::Object(extras);
        }
        light
    }
}

/// Le nœud qui instancie la lampe de rang `light`, à la matrice donnée.
pub(crate) fn light_node(name: &str, matrix: Value, light: usize) -> Value {
    json!({
        "name": name, "matrix": matrix,
        "extensions": {"KHR_lights_punctual": {"light": light}},
    })
}

/// Déclare les lampes dans le document. Une scène qui n'en porte aucune n'annonce pas l'extension :
/// son document reste celui qu'elle écrivait avant que ce chemin n'existe.
pub(crate) fn attach_lights(gltf: &mut Value, lights: &[Value]) {
    if lights.is_empty() {
        return;
    }
    gltf["extensions"] = json!({"KHR_lights_punctual": {"lights": lights}});
    gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
}
