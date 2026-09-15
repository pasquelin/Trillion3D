//! Ce que la couche dit d'elle-même — son unité, son axe haut — et ce que sa composition n'a pas
//! résolu.
//!
//! Une référence ou une charge vers un fichier absent ne fait pas échouer la composition : USD
//! compose ce qu'il trouve et laisse le prim vide. Un asset qui perd une pièce entière sans que
//! personne ne le dise est pire qu'un refus, donc le pilote relit les arcs écrits et compte ceux
//! dont le fichier n'est pas là. Le chemin d'un arc s'ancre sur la couche qui l'écrit : celle de la
//! source, la seule que ce pilote reçoive.
use super::*;

/// L'unité de la couche, en mètres par unité.
pub(super) fn meters_per_unit(stage: &usd::Stage) -> f64 {
    metadata(stage, "metersPerUnit")
        .as_ref()
        .and_then(read::number)
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .unwrap_or(1.0)
}

/// L'axe haut de la couche. USD le déclare `Y` par défaut.
pub(super) fn z_up(stage: &usd::Stage) -> bool {
    metadata(stage, "upAxis")
        .as_ref()
        .and_then(read::text)
        .as_deref()
        == Some("Z")
}

/// Une métadonnée composée de la couche.
fn metadata(stage: &usd::Stage, key: &str) -> Option<sdf::Value> {
    stage.stage_metadata(key).ok().flatten()
}

/// Ce prim porte-t-il un jeu de variantes ? Seule la sélection composée est lue.
pub(super) fn variants(world: &World<'_>, prim: &usd::Prim) -> bool {
    field(world, prim, "variantSetNames").is_some()
}

/// Le nombre d'arcs écrits sur ce prim — références et charges — dont le fichier visé n'est pas là.
pub(super) fn unresolved(world: &World<'_>, prim: &usd::Prim) -> usize {
    let references = match field(world, prim, "references") {
        Some(sdf::Value::ReferenceListOp(op)) => {
            op.iter().map(|arc| arc.asset_path.clone()).collect()
        }
        _ => Vec::new(),
    };
    let payloads = match field(world, prim, "payload") {
        Some(sdf::Value::PayloadListOp(op)) => {
            op.iter().map(|arc| arc.asset_path.clone()).collect()
        }
        _ => Vec::new(),
    };
    references
        .into_iter()
        .chain(payloads)
        .filter(|asset| !asset.is_empty())
        .filter(|asset| !anchored(world.images, asset).is_file())
        .count()
}

/// Le chemin d'un arc, ancré sur le dossier de la couche quand il est relatif.
fn anchored(root: &Path, asset: &str) -> PathBuf {
    let path = Path::new(asset);
    match path.is_absolute() {
        true => path.to_path_buf(),
        false => root.join(path),
    }
}

/// Un champ composé de ce prim.
fn field(world: &World<'_>, prim: &usd::Prim, name: &str) -> Option<sdf::Value> {
    world
        .stage
        .field::<sdf::Value>(prim.path().clone(), name)
        .ok()
        .flatten()
}
