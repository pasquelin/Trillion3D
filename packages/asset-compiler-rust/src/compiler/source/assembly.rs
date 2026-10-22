//! Mesh assemblies: a mesh whose `extras.assembly` names parts — other meshes — and nodes — a part
//! and a transform each (`spec.rs`) — is one mesh made of its own triangles and of every node's
//! part, each placed by its node's transform.
//!
//! The reference builds each part once, shares its clusters between every node that names it, and
//! reduces the instances' roots together with the mesh's own clusters into the levels above. Our
//! pages and our hierarchy hold no transform and one parent error for a cluster, so the part is
//! shared as the engine shares every mesh placed more than once: each node of the assembly becomes
//! a node of the scene, under each node that places the assembly's mesh, carrying the part's mesh
//! (`expand.rs`, as `instancing.rs` expands a GPU-instanced mesh). A part's pages are written once
//! however many nodes name it and however many times the assembly is placed. What this form does not
//! build is the reference's levels above the instances' roots, which merge the copies into one
//! coarser surface far away: an HLOD layer that merges the placed objects does that here.
//!
//! The reference builds an assembly only where the project allows it (a read-only project switch,
//! off by default): here a mesh's `allowAssemblies` setting (`meshBuild`, false by default). A mesh
//! that does not allow it is its own triangles alone, its `extras.assembly` left unread, and the
//! import report tells how many such meshes there are (`assembly-not-built`), as the reference
//! logs a warning for an assembly it does not build.
use crate::*;

mod expand;
mod spec;

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

/// Counts `count` assemblies left unbuilt in the import report of `manifest`.
fn tell_not_built(manifest: &mut Value, count: usize) {
    let report = &mut manifest["unsupported"];
    if report.is_null() {
        *report = json!({});
    }
    if let Some(reasons) = report.as_object_mut() {
        reasons.insert(NOT_BUILT.into(), json!(count));
    }
}

/// Lays out the assembly of every mesh that names one and allows it, before the plan: its nodes
/// become children of the nodes that place its mesh (`expand.rs`). A source naming none, or whose
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
        tell_not_built(&mut loaded.manifest, left.len());
    }
    expand::expand(&mut loaded.g, &allowed, o.ram_budget_bytes())
}

#[cfg(test)]
mod tests;
