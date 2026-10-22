//! A primitive's displacement baked into its triangles, before its clusters are built
//! (`displace`): where its mesh names height maps (`meshBuild`'s `displacementMaps`) and a
//! `trimmedError`, and it deforms nothing, its source as the build lays it — vertices built, the
//! triangles that meet dropped, the corners welded (`dag::laid_source`) — is tessellated and moved
//! along its normals. Its build then reads the displaced mesh as made (`InputRules::as_made`): the
//! normals the tessellation blended are kept, not rebuilt from the displaced triangles.
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::pages::record::Deformation;
use crate::dag::{laid_source, DagAttributes};
use crate::displace::{bake, Bake, Baked};
use trillion3d_page_codec::encode::Attribute;

/// The primitive's baked mesh, none where nothing is baked: its mesh names no map (`bake` none), a
/// trimmed error of 0, a skin, a morph target or a soft body (`deformation`), or it is the
/// placeholder of an assembly (`placeholder`), which holds no triangle to read.
pub(super) fn baked(
    bake_of: Option<&Bake>,
    build: &MeshBuild,
    (deformation, placeholder): (&Deformation, bool),
    (positions, attributes, indices): (&[f32], &[Attribute], &[u32]),
) -> Option<Baked> {
    let rigid = deformation.skin.is_none()
        && deformation.targets.is_empty()
        && deformation.soft_source.is_none();
    let settings = bake_of.filter(|_| rigid && !placeholder && build.trim.trimmed_error > 0.0)?;
    let carried: Vec<&Attribute> = attributes.iter().collect();
    let source = DagAttributes { carried: &carried };
    let rules = (&build.input, build.drop_near_collapsed);
    let laid = laid_source(positions, source, indices, rules);
    if laid.indices.is_empty() {
        return None;
    }
    let mesh = (&laid.positions[..], &laid.attributes[..]);
    Some(bake(
        settings,
        build.trim.trimmed_error,
        mesh,
        &laid.indices,
    ))
}
