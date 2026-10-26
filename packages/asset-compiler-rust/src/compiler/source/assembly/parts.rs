//! The meshes an assembly draws its parts from (`expand.rs`), and what a part takes of its
//! assembly: the materials its remap names, and the ten settings the assembly mesh resolves — its
//! shape, tangents, texture hold, edge bound and the six voxel settings — whatever a rule, the scene
//! or the part's own `extras` say of them.
//!
//! A part whose mesh already wears the materials and settings the assembly gives it is drawn from
//! its own mesh; any other is a copy, made once for the assembly. Either way the mesh is marked
//! (`PART_EXTRA`): the readers of a mesh's build settings (`MeshBuildOptions::meshes`,
//! `VoxelizeOptions::meshes`) then give it its assembly's tangents, voxel settings and voxelization
//! above every other source. The three settings only a mesh's `extras` name — its shape word, edge
//! bound and texture hold — are written into the copy's `extras` as the assembly's own say them.
use super::plan::{extra, material_of, part_of, PART_EXTRA};
use super::spec::Spec;
use crate::compiler::args::mesh_build::MeshBuild;
use crate::*;

/// What the load knows of how each mesh of the document is built before an assembly is laid out:
/// the builds (`MeshBuildOptions::meshes`) and the meshes drawn as voxels (`VoxelizeOptions::meshes`),
/// each by the mesh's rank.
pub(super) struct Resolved<'a> {
    pub builds: &'a [MeshBuild],
    pub voxelized: &'a BTreeSet<usize>,
}

/// The settings of a mesh's build that a part takes from its assembly mesh: the one list of what is
/// compared (`Resolved::of`) and of what is copied (`apply`).
#[derive(Clone, Copy, PartialEq)]
struct Inherited {
    stored_tangents: bool,
    voxels: crate::voxel::VoxelSettings,
}

impl Inherited {
    /// What `build` holds of them.
    fn of(build: &MeshBuild) -> Self {
        Self {
            stored_tangents: build.stored_tangents,
            voxels: build.voxels,
        }
    }

    /// `build` with them set.
    fn apply(self, build: &mut MeshBuild) {
        build.stored_tangents = self.stored_tangents;
        build.voxels = self.voxels;
    }
}

impl Resolved<'_> {
    /// The settings of mesh `mesh` of `g` a part takes from its assembly (`Inherited`), and its
    /// shape, which a copy of the part takes through its `extras` (`FROM_EXTRAS`).
    fn of(&self, g: &Value, mesh: usize) -> Result<(Inherited, crate::dag::MeshShaping)> {
        let shaping =
            crate::dag::MeshShaping::read(&g["meshes"][mesh], self.voxelized.contains(&mesh))?;
        Ok((Inherited::of(&self.builds[mesh]), shaping))
    }
}

/// The settings only a mesh's `extras` name, which a copy of a part takes as they stand in its
/// assembly's: its shape word, its edge length bound, whether it holds its texture coordinates.
const FROM_EXTRAS: [&str; 3] = [VOXELIZE_EXTRA, EDGE_LENGTH_SETTING, HOLD_TEXTURE_SETTING];

/// The material primitive `i` of a part is drawn with: the remap's entry when it lists one; past
/// the end of the list the assembly's first slot; with no list the assembly's slot `i` — a slot
/// being the material of the assembly mesh's primitive of that rank, none past its last.
fn remapped(remap: Option<&[Option<usize>]>, slots: &[Option<usize>], i: usize) -> Option<usize> {
    match remap {
        Some(list) => list
            .get(i)
            .copied()
            .unwrap_or(slots.first().copied().flatten()),
        None => slots.get(i).copied().flatten(),
    }
}

/// A copy of the mesh `part`, wearing `worn` — a material for each primitive — and the settings
/// only `extras` name that the assembly mesh `assembly` of `g` names, marked a part of it.
fn copy_of(g: &Value, (assembly, part): (usize, usize), worn: &[Option<usize>]) -> Value {
    let mut copy = g["meshes"][part].clone();
    let primitives = copy["primitives"].as_array_mut().into_iter().flatten();
    for (primitive, material) in primitives.zip(worn) {
        match material {
            Some(material) => primitive["material"] = json!(material),
            None => {
                let fields = primitive.as_object_mut();
                fields.map(|fields| fields.remove("material"));
            }
        }
    }
    for key in FROM_EXTRAS {
        match extra(&g["meshes"][assembly], key) {
            Some(value) => copy["extras"][key] = value.clone(),
            None => {
                let extras = copy["extras"].as_object_mut();
                extras.map(|extras| extras.remove(key));
            }
        }
    }
    copy["extras"][PART_EXTRA] = json!(assembly);
    copy
}

/// The mesh each part of `spec`, the assembly of mesh `assembly`, is drawn from: its own when it
/// already wears the materials the assembly gives it and resolves the settings the assembly
/// resolves (`resolved`), else a copy wearing them, appended to the document's meshes once for the
/// assembly. Each is marked a part of the assembly (`PART_EXTRA`), a mesh of two assemblies that
/// resolve alike by the first.
pub(super) fn part_meshes(
    g: &mut Value,
    assembly: usize,
    spec: &Spec,
    resolved: &Resolved<'_>,
) -> Result<Vec<usize>> {
    let primitives = g["meshes"][assembly]["primitives"].as_array();
    let slots: Vec<Option<usize>> = primitives
        .map(|list| list.iter().map(material_of).collect())
        .unwrap_or_default();
    let taken = resolved.of(g, assembly)?;
    let mut drawn = Vec::with_capacity(spec.parts.len());
    for part in &spec.parts {
        let primitives = g["meshes"][part.mesh]["primitives"].as_array();
        let primitives = primitives.map_or(&[][..], Vec::as_slice);
        let worn: Vec<Option<usize>> = (0..primitives.len())
            .map(|i| remapped(part.remap.as_deref(), &slots, i))
            .collect();
        let own: Vec<Option<usize>> = primitives.iter().map(material_of).collect();
        if worn == own && resolved.of(g, part.mesh)? == taken {
            let extras = &mut g["meshes"][part.mesh]["extras"];
            if extras.get(PART_EXTRA).is_none() {
                extras[PART_EXTRA] = json!(assembly);
            }
            drawn.push(part.mesh);
            continue;
        }
        let copy = copy_of(g, (assembly, part.mesh), &worn);
        let meshes = g["meshes"]
            .as_array_mut()
            .ok_or_else(|| invalid("meshes array is required"))?;
        meshes.push(copy);
        drawn.push(meshes.len() - 1);
    }
    Ok(drawn)
}

/// `builds`, the build settings of `meshes` by rank, with the stored tangents and the voxel settings
/// of each mesh drawn as a part (`PART_EXTRA`) those of its assembly mesh: above a rule, the scene
/// and the part's own `extras`.
pub(crate) fn inherit_builds(meshes: &[Value], builds: &mut [MeshBuild]) {
    for (rank, mesh) in meshes.iter().enumerate() {
        let Some(assembly) = part_of(mesh).filter(|&assembly| assembly < builds.len()) else {
            continue;
        };
        Inherited::of(&builds[assembly]).apply(&mut builds[rank]);
    }
}

/// `voxelized`, the meshes drawn as voxels far away: a mesh drawn as a part of an assembly is
/// where its assembly is, whatever names it.
pub(crate) fn inherit_voxelized(meshes: &[Value], voxelized: &mut BTreeSet<usize>) {
    for (rank, mesh) in meshes.iter().enumerate() {
        if let Some(assembly) = part_of(mesh) {
            match voxelized.contains(&assembly) {
                true => voxelized.insert(rank),
                false => voxelized.remove(&rank),
            };
        }
    }
}
