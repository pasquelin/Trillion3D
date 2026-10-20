//! What the layer says of itself — its unit, its up axis — and what its composition did not
//! resolve.
//!
//! A reference or payload toward a missing file does not fail composition: USD composes what it
//! finds and leaves the prim empty. An asset that loses a whole piece with nobody saying so is
//! worse than a rejection, so the driver rereads the written arcs and counts those whose file is
//! not there. An arc's path anchors on the layer that writes it: the source's, the only one this
//! driver receives.
use super::*;

/// Implicit unit of a USD layer: the centimetre.
use crate::plugins::scene::axes::CENTIMETRE as DEFAULT_METERS_PER_UNIT;

/// Layer unit, in metres per unit. A missing, zero or non-finite value falls back to the
/// implicit unit rather than inventing a scale.
pub(super) fn meters_per_unit(stage: &usd::Stage) -> f64 {
    metadata(stage, "metersPerUnit")
        .as_ref()
        .and_then(read::number)
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .unwrap_or(DEFAULT_METERS_PER_UNIT)
}

/// Up axis of the layer. USD declares it `Y` by default.
pub(super) fn z_up(stage: &usd::Stage) -> bool {
    metadata(stage, "upAxis")
        .as_ref()
        .and_then(read::text)
        .as_deref()
        == Some("Z")
}

/// A composed metadata of the layer.
fn metadata(stage: &usd::Stage, key: &str) -> Option<sdf::Value> {
    stage.stage_metadata(key).ok().flatten()
}

/// Does this prim carry a variant set? Only the composed selection is read.
pub(super) fn variants(world: &World<'_>, prim: &usd::Prim) -> bool {
    field(world, prim, "variantSetNames").is_some()
}

/// Number of arcs written on this prim — references and payloads — whose target file is not there.
pub(super) fn unresolved(world: &World<'_>, prim: &usd::Prim) -> usize {
    // Each field holds its own list type: `references` a reference list, `payload` a payload list.
    let assets = |name: &str| -> Vec<String> {
        match field(world, prim, name) {
            Some(sdf::Value::ReferenceListOp(op)) => {
                op.iter().map(|arc| arc.asset_path.clone()).collect()
            }
            Some(sdf::Value::PayloadListOp(op)) => {
                op.iter().map(|arc| arc.asset_path.clone()).collect()
            }
            _ => Vec::new(),
        }
    };
    assets("references")
        .into_iter()
        .chain(assets("payload"))
        .filter(|asset| !asset.is_empty())
        .filter(|asset| !anchored(world.images, asset).is_file())
        .count()
}

/// Path of an arc, anchored on the layer directory when it is relative.
fn anchored(root: &Path, asset: &str) -> PathBuf {
    let path = Path::new(asset);
    match path.is_absolute() {
        true => path.to_path_buf(),
        false => root.join(path),
    }
}

/// A composed field of this prim.
fn field(world: &World<'_>, prim: &usd::Prim, name: &str) -> Option<sdf::Value> {
    world
        .stage
        .field::<sdf::Value>(prim.path().clone(), name)
        .ok()
        .flatten()
}
