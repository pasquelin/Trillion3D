//! A primitive read from its document before its DAG is built (`../primitive.rs`): where it lies,
//! its positions and the corners of its triangles (`read_primitive`), how its mesh keeps its shape
//! (`shaping_of`), and the deformation and attributes its pages carry (`page_data`).
use super::{triangles, PrimitiveInputs};
use crate::compiler::pages::record::{page_attributes, page_deformation, Deformation, PageSource};
use crate::compiler::source::assembly::plan::{extra, TOP_EXTRA};
use crate::*;

/// A primitive as its document declares it: its place in it, the vertices of its `POSITION`, its
/// positions decoded and the corners of its triangles — none for a placeholder an assembly's load
/// added, whose one triangle is never read (`carriers.rs`).
pub(super) struct Reading<'a> {
    pub mesh: &'a Value,
    pub primitive: &'a Value,
    pub count: usize,
    pub pos: Vec<f32>,
    pub indices: Vec<u32>,
    pub placeholder: bool,
}

/// Primitive `primitive` of source mesh `old`, read.
pub(super) fn read_primitive<'a>(
    inputs: &PrimitiveInputs<'a>,
    old: usize,
    primitive: usize,
) -> Result<Reading<'a>> {
    let mesh = item(inputs.mesh_values, old, "mesh")?;
    let p = item(values(mesh, "primitives")?, primitive, "primitive")?;
    let (positions, indices, _) = triangles::read(inputs.g, inputs.bin, p, Some(inputs.validated))?;
    let placeholder = extra(p, TOP_EXTRA).is_some();
    let pos = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::Decode);
        positions.collect_f32()?
    };
    Ok(Reading {
        mesh,
        primitive: p,
        count: positions.count,
        pos,
        indices: if placeholder { Vec::new() } else { indices },
        placeholder,
    })
}

/// How its source mesh keeps its shape as its DAG is built: the job's `meshBuild` over the mesh's
/// own extras.
pub(super) fn shaping_of(
    inputs: &PrimitiveInputs<'_>,
    read: &Reading<'_>,
    old: usize,
) -> Result<crate::dag::MeshShaping> {
    let build = &inputs.mesh_builds[old];
    Ok(crate::dag::MeshShaping {
        trim: build.trim,
        drop_near_collapsed: build.drop_near_collapsed,
        input: build.input,
        ..crate::dag::MeshShaping::read(read.mesh, inputs.voxelized.contains(&old))?
    })
}

/// Its deformation (skin and morph pages share the GPU deformation stage before cut and raster) and
/// the attributes its pages carry.
pub(super) fn page_data(
    inputs: &PrimitiveInputs<'_>,
    read: &Reading<'_>,
    old: usize,
) -> Result<(Deformation, Vec<encode::Attribute>)> {
    let build = &inputs.mesh_builds[old];
    let (g, bin, validated) = (inputs.g, inputs.bin, inputs.validated);
    let mut deformation = page_deformation(g, bin, read.primitive, read.count, validated)?;
    // A mesh without bones whose build rebuilds every normal makes them when its source has none;
    // a skinned one's build keeps the frames it reads (`dag/input/frames.rs`). A primitive without
    // tangents fills them when another of its mesh has some.
    let made_normals = build.input.recompute_normals && deformation.skin.is_none();
    let mesh_tangents = (values(read.mesh, "primitives")?.iter())
        .any(|q| q.pointer("/attributes/TANGENT").is_some());
    let source = PageSource {
        count: read.count,
        stored_tangents: build.stored_tangents,
        made_normals,
        mesh_tangents,
    };
    let attributes = page_attributes(g, bin, read.primitive, source, validated)?;
    crate::geometry_page::deform::declare_soft(&mut deformation, g, old, &read.pos)?;
    Ok((deformation, attributes))
}
