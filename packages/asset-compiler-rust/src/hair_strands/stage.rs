//! The hair strands stage: the grooms the scene's nodes carried (`take`) are merged into the one groom
//! of the scene, each placed by the world matrix of its node, then built group by group (`build.rs`)
//! and written in one product, `hairStrands.bin`, which the manifest's `hairStrands` section names
//! (`write_hair_strands`). A scene that carries no curve, or none a group is built of, writes
//! neither.
use super::build::groups;
use super::carrier::Carried;
use super::description::Description;
use super::encode::{report, write};
use crate::compiler::cache::storage::Product;
use crate::compiler::source::node_transform::Mat4;
use crate::support::perf::{Phase, Timer};
use crate::{HairOptions, Result};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use trillion3d_math::matrix::IDENTITY;

/// What the stage reads: the grooms taken out of the scene, the world matrix of every node, the nodes
/// the rendered scene reaches and those a hidden node hides (`Picked`), whether a curve is given a
/// control point more at its end (the job's `hairEndingPoint`) and the settings the job gives the groups
/// (`hairGroups`), and the job's cancellation token.
pub(crate) struct HairInputs<'a> {
    pub carried: &'a [Carried],
    pub world: &'a [Mat4],
    pub scene_nodes: &'a BTreeSet<usize>,
    pub hidden: &'a BTreeSet<usize>,
    pub settings: &'a HairOptions,
    pub cancelled: &'a AtomicBool,
}

/// The groom of the scene: the curves of every node the scene shows, in the order of the nodes, each
/// object's points placed by its node's world matrix. A single object that no matrix moves is the
/// groom itself, not copied.
pub(super) fn merged<'a>(inputs: &HairInputs<'a>) -> Cow<'a, Description> {
    let carried: &'a [Carried] = inputs.carried;
    let shown: Vec<&Carried> = carried
        .iter()
        .filter(|one| one.is_shown(inputs.scene_nodes, inputs.hidden))
        .collect();
    let matrix =
        |one: &Carried| Some(&inputs.world[one.node]).filter(|matrix| **matrix != IDENTITY);
    if let [one] = shown.as_slice() {
        if matrix(one).is_none() {
            return Cow::Borrowed(&one.description);
        }
    }
    let mut groom = Description::default();
    let (strands, points) = shown.iter().fold((0, 0), |(strands, points), one| {
        let (more, added) = one.description.shape();
        (strands + more, points + added)
    });
    groom.reserve(strands, points);
    for one in shown {
        groom.append(&one.description, matrix(one));
    }
    Cow::Owned(groom)
}

/// Builds the groom of the scene `inputs` carries and writes it as `hairStrands.bin` in `directory`;
/// returns its product and the manifest's `hairStrands` section, none when there is no group.
pub(crate) fn write_hair_strands(
    inputs: &HairInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    if inputs.carried.is_empty() {
        return Ok(None);
    }
    let _t = Timer::new(Phase::HairStrands);
    let mut built = groups(
        &merged(inputs),
        inputs.settings.ending_point(),
        inputs.cancelled,
    )?;
    // The settings the job names for a group travel in its flags.
    for group in &mut built {
        group.flags |= inputs.settings.group_flags(group.id);
    }
    if built.is_empty() {
        return Ok(None);
    }
    let written = write(&built, directory)?;
    let section = report(&built, written.bytes as usize);
    progress(json!({"phase":"hairStrands","completed":1,"total":1,"groups":built.len()}));
    Ok(Some((written, section)))
}
