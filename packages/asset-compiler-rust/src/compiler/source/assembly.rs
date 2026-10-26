//! Mesh assemblies: a mesh whose `extras.assembly` names parts — other meshes — and nodes — a part
//! and a transform each (`spec.rs`) — is one mesh made of its own triangles and of every node's
//! part, each placed by its node's transform.
//!
//! The reference builds each part once, shares its clusters between every node that names it, and
//! reduces the instances' roots together with the mesh's own clusters into the levels above, each
//! instance keeping the error and the ball of the group that replaces its root. Here each node of
//! the assembly becomes a node of the scene, under each node that places the assembly's mesh,
//! carrying the part's mesh (`expand.rs`, as `instancing.rs` expands a GPU-instanced mesh): a part's
//! pages are written once however many nodes name it and however many times the assembly is
//! placed. The levels above are built in the primitives of the assembly's mesh that carry them
//! (`carriers.rs`, `plan.rs`; `dag::assembly`): the mesh's own triangles are their level 0, the
//! roots of the parts' primitives climb beside them, and each instance carries, in the scene's
//! tables, the error and the ball of its group (`rootParents`), which the cut tests before it
//! opens the instance: far away the group's clusters draw, near the instance does.
//!
//! The reference builds an assembly only where the project allows it (a read-only project switch,
//! off by default): here a mesh's `allowAssemblies` setting (`meshBuild`, false by default). A mesh
//! that does not allow it is its own triangles alone, its `extras.assembly` left unread, and the
//! import report tells how many such meshes there are (`assembly-not-built`), as the reference
//! logs a warning for an assembly it does not build. It tells too how many groups of instances
//! climb nowhere (`assembly-group-not-merged`): their instances draw down to their own roots.
//!
//! A part is built with the settings its assembly's mesh resolves, the ten the reference hands
//! on (`parts.rs`): they come from the build settings the job resolved for the assembly — a rule,
//! the scene, its `extras` — never from what the part names.
use crate::*;

mod carriers;
mod expand;
pub(crate) mod parts;
pub(crate) mod plan;
mod spec;

use plan::NOT_MERGED;
pub(crate) use spec::names_assembly;

/// The reason an assembly left unbuilt is counted under in the import report.
const NOT_BUILT: &str = "assembly-not-built";

/// The meshes of `g` that name an assembly.
fn assembly_meshes(g: &Value) -> Vec<usize> {
    let meshes = g.get("meshes").and_then(Value::as_array);
    let meshes = meshes.map_or(&[][..], Vec::as_slice);
    (meshes.iter().enumerate())
        .filter(|(_, mesh)| names_assembly(mesh))
        .map(|(at, _)| at)
        .collect()
}

/// Counts `count` of what the import report of `manifest` tells under `reason`.
pub(crate) fn tell(manifest: &mut Value, reason: &str, count: usize) {
    let report = &mut manifest["unsupported"];
    if report.is_null() {
        *report = json!({});
    }
    if let Some(reasons) = report.as_object_mut() {
        reasons.insert(reason.into(), json!(count));
    }
}

/// The meshes of `g` the job draws as voxels far away, read as the compile reads them.
fn voxelized_meshes(o: &Options, g: &Value) -> Result<BTreeSet<usize>> {
    let hlod = o.hlod()?;
    o.voxelize()?.meshes(g, hlod, &hlod.assignments(g)?)
}

/// Lays out the assembly of every mesh that names one and allows it, before the plan: its nodes
/// become children of the nodes that place its mesh (`expand.rs`), the primitives that carry the
/// levels above them are told or added (`carriers.rs`). A source naming none, or whose
/// job allows none, is left as it is, the meshes that name one and do not allow it counted in the
/// import report.
pub(crate) fn expand_assemblies(o: &Options, loaded: &mut RuntimeSource) -> Result<()> {
    let named = assembly_meshes(&loaded.g);
    if named.is_empty() {
        return Ok(());
    }
    let builds = o.mesh_build()?.meshes(&loaded.g)?;
    let (allowed, left): (Vec<usize>, Vec<usize>) =
        (named.into_iter()).partition(|&mesh| builds[mesh].allow_assemblies);
    if let Some(&mesh) = allowed.iter().find(|mesh| loaded.bent.contains(mesh)) {
        return Err(crate::compiler::source::spline::refuse_bent_assembly(mesh));
    }
    if !left.is_empty() {
        tell(&mut loaded.manifest, NOT_BUILT, left.len());
    }
    if allowed.is_empty() {
        return Ok(());
    }
    let voxelized = voxelized_meshes(o, &loaded.g)?;
    let resolved = parts::Resolved {
        builds: &builds,
        voxelized: &voxelized,
    };
    expand::expand(&mut loaded.g, &allowed, &resolved, o.ram_budget_bytes())?;
    // The levels above the instances exist where the build makes coarse levels at all.
    if crate::dag::DagStrategy::named(&o.simplification) != crate::dag::DagStrategy::ExactClusters {
        let binary = std::mem::replace(&mut loaded.binary, Binary::Owned(Vec::new()));
        let laid = carriers::lay(&mut loaded.g, binary, o.ram_budget_bytes())?;
        loaded.binary = laid.binary;
        if laid.alone > 0 {
            tell(&mut loaded.manifest, NOT_MERGED, laid.alone);
        }
    }
    expand::strip_bare(&mut loaded.g);
    Ok(())
}

#[cfg(test)]
mod tests;
