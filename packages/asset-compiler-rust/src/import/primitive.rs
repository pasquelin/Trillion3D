//! L'émission d'une primitive glTF à partir de sommets déjà dédupliqués, partagée par les pilotes
//! de scène qui construisent leur géométrie eux-mêmes.
//!
//! Ce qui est ici ne dépend d'aucun format : des tableaux parallèles de sommets et une suite
//! d'indices deviennent des vues de binaire, des accesseurs et la primitive qui les cite. Ce qui
//! dépend du format — comment on arrive à ces tableaux — reste chez le pilote.
use super::*;

/// Les sommets d'une primitive, dédupliqués par le pilote. `positions` est obligatoire ; un tableau
/// vide dit que cet attribut n'existe pas sur cette primitive et n'est donc pas écrit.
#[derive(Default)]
pub(crate) struct Vertices {
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
    pub(crate) uvs: Vec<f32>,
    pub(crate) colors: Vec<f32>,
    pub(crate) indices: Vec<u32>,
}

impl Vertices {
    /// Le nombre de sommets, déduit des positions.
    pub(crate) fn count(&self) -> usize {
        self.positions.len() / 3
    }
}

/// Écrit les sommets dans `bin`, pousse leurs accesseurs et rend la primitive glTF qui les cite.
/// `material` est le rang du matériau de cette primitive, `None` quand elle n'en porte aucun.
///
/// Les bornes de `POSITION` sont calculées ici sur les positions écrites, comme le veut glTF : un
/// accesseur de position sans `min`/`max` n'est pas lisible par un moteur qui découpe la scène.
pub(crate) fn primitive(
    vertices: &Vertices,
    bin: &mut Bin,
    accessors: &mut Vec<Value>,
    material: Option<usize>,
) -> Value {
    let count = vertices.count();
    let (min, max) = bounds(&vertices.positions);
    let view = bin.view(&f32_bytes(&vertices.positions), Some(34962));
    accessors.push(
        json!({"bufferView":view,"componentType":5126,"count":count,"type":"VEC3","min":min,"max":max}),
    );
    let mut attributes = json!({ "POSITION": accessors.len() - 1 });
    for (name, values, kind) in [
        ("NORMAL", &vertices.normals, "VEC3"),
        ("TEXCOORD_0", &vertices.uvs, "VEC2"),
        ("COLOR_0", &vertices.colors, "VEC4"),
    ] {
        if values.is_empty() {
            continue;
        }
        let view = bin.view(&f32_bytes(values), Some(34962));
        accessors.push(json!({"bufferView":view,"componentType":5126,"count":count,"type":kind}));
        attributes[name] = json!(accessors.len() - 1);
    }
    let (bytes, component) = index_bytes(&vertices.indices, count);
    let view = bin.view(&bytes, Some(34963));
    accessors.push(
        json!({"bufferView":view,"componentType":component,"count":vertices.indices.len(),"type":"SCALAR"}),
    );
    let mut primitive = json!({"attributes":attributes,"indices":accessors.len()-1,"mode":4});
    if let Some(material) = material {
        primitive["material"] = json!(material);
    }
    primitive
}

/// Les bornes d'un tableau de positions, par axe.
fn bounds(positions: &[f32]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::MAX; 3];
    let mut max = [f32::MIN; 3];
    for vertex in positions.as_chunks::<3>().0 {
        crate::shared_math::extend_aabb_f32(&mut min, &mut max, *vertex);
    }
    (min, max)
}
