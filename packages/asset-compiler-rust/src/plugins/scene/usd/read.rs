//! La lecture d'un attribut composé, et la conversion de sa valeur vers ce que la scène
//! intermédiaire sait porter.
//!
//! USD type ses attributs finement — `point3f[]`, `point3d[]`, `normal3h[]` décrivent la même chose
//! à la précision près — et une scène réelle mélange les trois. Chaque fonction d'ici accepte donc
//! toutes les écritures d'une même grandeur et rend la forme unique que le glTF demande. Ce qui ne
//! s'y ramène pas rend `None` : l'appelant le compte par son nom, il ne devine pas.
use openusd::{sdf, usd};

/// La valeur par défaut d'un attribut, ou son premier échantillon temporel quand il n'en a pas. Le
/// second membre dit lequel des deux a répondu : une scène lue à son premier échantillon est figée,
/// et l'appelant le publie au rapport.
pub(super) fn first(attribute: &usd::Attribute) -> Option<(sdf::Value, bool)> {
    if let Ok(Some(value)) = attribute.get::<sdf::Value>() {
        return Some((value, false));
    }
    let samples = attribute.time_samples().ok().flatten()?;
    samples
        .iter()
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, value)| (value.clone(), true))
}

/// Un nombre : flottant, double, demi ou entier.
pub(super) fn number(value: &sdf::Value) -> Option<f64> {
    Some(match value {
        sdf::Value::Float(v) => f64::from(*v),
        sdf::Value::Double(v) => *v,
        sdf::Value::Half(v) => f64::from(f32::from(*v)),
        sdf::Value::Int(v) => f64::from(*v),
        _ => return None,
    })
}

/// Un triplet : une couleur, une normale, une position ou les trois angles d'une rotation.
pub(super) fn triple(value: &sdf::Value) -> Option<[f64; 3]> {
    Some(match value {
        sdf::Value::Vec3f(v) => [f64::from(v.x), f64::from(v.y), f64::from(v.z)],
        sdf::Value::Vec3d(v) => [v.x, v.y, v.z],
        sdf::Value::Vec3h(v) => [
            f64::from(f32::from(v.x)),
            f64::from(f32::from(v.y)),
            f64::from(f32::from(v.z)),
        ],
        _ => return None,
    })
}

/// Un tableau de triplets : des points, des normales ou des couleurs par sommet.
pub(super) fn triples(value: &sdf::Value) -> Option<Vec<[f32; 3]>> {
    Some(match value {
        sdf::Value::Vec3fVec(v) => v.iter().map(|p| [p.x, p.y, p.z]).collect(),
        sdf::Value::Vec3dVec(v) => v
            .iter()
            .map(|p| [p.x as f32, p.y as f32, p.z as f32])
            .collect(),
        sdf::Value::Vec3hVec(v) => v
            .iter()
            .map(|p| [f32::from(p.x), f32::from(p.y), f32::from(p.z)])
            .collect(),
        _ => return None,
    })
}

/// Un tableau de paires : des coordonnées de texture.
pub(super) fn pairs(value: &sdf::Value) -> Option<Vec<[f32; 2]>> {
    Some(match value {
        sdf::Value::Vec2fVec(v) => v.iter().map(|p| [p.x, p.y]).collect(),
        sdf::Value::Vec2dVec(v) => v.iter().map(|p| [p.x as f32, p.y as f32]).collect(),
        sdf::Value::Vec2hVec(v) => v.iter().map(|p| [f32::from(p.x), f32::from(p.y)]).collect(),
        _ => return None,
    })
}

/// Un tableau d'entiers : des comptes de sommets par face, des indices, des faces d'un `GeomSubset`.
/// Un entier négatif ou hors du domaine d'un `usize` devient `None` à l'usage, jamais une panique.
pub(super) fn integers(value: &sdf::Value) -> Option<Vec<i64>> {
    Some(match value {
        sdf::Value::IntVec(v) => v.iter().map(|i| i64::from(*i)).collect(),
        sdf::Value::UintVec(v) => v.iter().map(|i| i64::from(*i)).collect(),
        sdf::Value::Int64Vec(v) => v.clone(),
        sdf::Value::Uint64Vec(v) => v.iter().map(|i| *i as i64).collect(),
        _ => return None,
    })
}

/// Un texte : un jeton ou une chaîne, que USD emploie l'un pour l'autre selon les schémas.
pub(super) fn text(value: &sdf::Value) -> Option<String> {
    Some(match value {
        sdf::Value::Token(v) => v.as_str().to_string(),
        sdf::Value::String(v) => v.clone(),
        _ => return None,
    })
}

/// Un booléen.
pub(super) fn flag(value: &sdf::Value) -> Option<bool> {
    match value {
        sdf::Value::Bool(v) => Some(*v),
        _ => None,
    }
}

/// Le chemin d'asset écrit dans la couche, avant toute résolution : c'est lui que le pilote résout
/// lui-même, contre la racine où le compilateur relira les images.
pub(super) fn asset(value: &sdf::Value) -> Option<String> {
    match value {
        sdf::Value::AssetPath(path) => Some(path.authored_path.clone()),
        _ => None,
    }
}

/// Les seize nombres d'un `matrix4d`, déjà dans l'ordre de glTF.
pub(super) fn matrix(value: &sdf::Value) -> Option<[f64; 16]> {
    match value {
        sdf::Value::Matrix4d(m) => Some(m.0),
        _ => None,
    }
}

/// Un quaternion `(w, x, y, z)`.
pub(super) fn quaternion(value: &sdf::Value) -> Option<[f64; 4]> {
    Some(match value {
        sdf::Value::Quatf(q) => [
            f64::from(q.w),
            f64::from(q.x),
            f64::from(q.y),
            f64::from(q.z),
        ],
        sdf::Value::Quatd(q) => [q.w, q.x, q.y, q.z],
        sdf::Value::Quath(q) => [
            f64::from(f32::from(q.w)),
            f64::from(f32::from(q.x)),
            f64::from(f32::from(q.y)),
            f64::from(f32::from(q.z)),
        ],
        _ => return None,
    })
}

/// Une métadonnée d'attribut lue en texte — `interpolation` d'une primvar, entre autres.
pub(super) fn metadata(attribute: &usd::Attribute, key: &str) -> Option<String> {
    attribute
        .get_metadata::<sdf::Value>(key)
        .ok()
        .flatten()
        .as_ref()
        .and_then(text)
}
