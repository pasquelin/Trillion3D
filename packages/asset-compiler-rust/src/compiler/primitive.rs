use crate::compiler::pages::record::PageSource;
use crate::compiler::primitive::warn::primitive_event;
use crate::*;
use trillion3d_page_codec::bits::grid::PageGrid;
pub(crate) mod checks;
pub(crate) mod compiled;
pub(crate) mod cost;
pub(crate) mod dag;
pub(crate) mod pages;
pub(crate) mod stalls;
pub(crate) mod triangles;
pub(crate) mod warn;
pub(crate) struct PrimitiveInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_values: &'a [Value],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    /// The source meshes whose far levels may be voxels (`VoxelizeOptions::meshes`).
    pub voxelized: &'a BTreeSet<usize>,
    /// The source meshes a merged layer may take (`Hlod::merged_meshes`): the LODs of the others
    /// are never cut for the merge (`flatten::merge::Lods`).
    pub merged: &'a BTreeSet<usize>,
    /// Each source mesh's build settings, by its rank (`MeshBuildOptions::meshes`).
    pub mesh_builds: &'a [crate::compiler::args::mesh_build::MeshBuild],
    /// Largest world scale under which each source mesh is placed: it is what
    /// brings the proxy threshold, expressed in metres, into the primitive's
    /// object space.
    pub mesh_scales: &'a BTreeMap<usize, f64>,
    /// Triangles of the whole scene, every instance placed: the denominator of budget shares.
    pub scene_triangles: usize,
    /// Accessors that `plan_buffers` has already validated once, on the same bytes.
    pub validated: &'a BTreeSet<usize>,
    pub progress: &'a (dyn Fn(Value) + Sync),
}
/// A compiled primitive and what later stages read beside it once every primitive is done.
pub(crate) struct CompiledPrimitive {
    pub value: Value,
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// The resident proxy's coarse cut, in object space, and the threshold in metres it requested.
    pub proxy_cut: Vec<f32>,
    pub proxy_threshold: f64,
    pub collision: Value,
    pub source_cover: crate::hlod::chain::SourceCover,
    /// The groups its far field may draw as voxels.
    pub voxel_seed: crate::voxel::VoxelSeed,
    /// The run of its pages' bytes, which the geometry containers take (`pages/containers.rs`).
    pub page_run: Option<PageRun>,
}
/// Whether the engine draws `material` blended, sorted back to front and never merged with another
/// surface: `alphaMode` `BLEND` once the cutout decisions have rewritten the scene
/// (`cutout::apply_decisions`), or a transmission, whatever its mode (`transmissive_material`). The one
/// test of a primitive's `pass`.
pub(crate) fn drawn_blended(material: Option<&Value>) -> bool {
    transmissive_material(material)
        || material.is_some_and(|m| AlphaMode::of(m) == AlphaMode::Blend)
}
/// Whether primitive `p` draws triangles (`mode` 4, the default).
fn triangle_mode(p: &Value) -> Result<bool> {
    Ok(optional_index(p.get("mode"), "primitive.mode", 4)? == 4)
}
/// The material primitive `p` names, if any.
fn primitive_material<'g>(g: &'g Value, p: &Value) -> Result<Option<&'g Value>> {
    match p.get("material") {
        Some(material) => {
            Ok(values(g, "materials")?.get(required_index(Some(material), "primitive.material")?))
        }
        None => Ok(None),
    }
}
/// `compile_primitive` of one planned `(mesh, primitive)` job, its error naming the job.
pub(crate) fn compile_job(
    inputs: &PrimitiveInputs<'_>,
    &(m, p): &(usize, usize),
) -> Result<CompiledPrimitive> {
    compile_primitive(inputs, m, p).map_err(|e| e.within(m, p))
}
pub(crate) fn compile_primitive(
    inputs: &PrimitiveInputs<'_>,
    old: usize,
    primitive: usize,
) -> Result<CompiledPrimitive> {
    let PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values,
        mesh_map,
        voxelized,
        merged,
        mesh_builds,
        mesh_scales,
        scene_triangles,
        validated,
        progress,
        ..
    } = inputs;
    check(o)?;
    let source_mesh = item(mesh_values, old, "mesh")?;
    let p = item(values(source_mesh, "primitives")?, primitive, "primitive")?;
    if !triangle_mode(p)? {
        return Err(CompilerError::new(
            "UNSUPPORTED_PRIMITIVE",
            "Only static triangles are supported",
        ));
    }
    let (positions, index_values, triangle_count) = triangles::read(g, bin, p, Some(validated))?;
    let pos = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::Decode);
        positions.collect_f32()?
    };
    let material = primitive_material(g, p)?;
    // Skin and morph pages share the GPU deformation stage before cut/raster.
    let blended = drawn_blended(material);
    let mesh = *mesh_map
        .get(&old)
        .ok_or_else(|| invalid("Missing mesh mapping"))?;
    // How its source mesh is built: the job's `meshBuild` over the mesh's own extras.
    let build = mesh_builds[old];
    let shaping = crate::dag::MeshShaping {
        trim: build.trim,
        drop_near_collapsed: build.drop_near_collapsed,
        input: build.input,
        ..crate::dag::MeshShaping::read(source_mesh, voxelized.contains(&old))?
    };
    let mut deformation =
        super::pages::record::page_deformation(g, bin, p, positions.count, validated)?;
    // A mesh without bones whose build rebuilds every normal makes them when its source has none;
    // a skinned one's build keeps the frames it reads (`dag/input/frames.rs`). A primitive without
    // tangents fills them when another of its mesh has some.
    let made_normals = build.input.recompute_normals && deformation.skin.is_none();
    let mesh_tangents = (values(source_mesh, "primitives")?.iter())
        .any(|q| q.pointer("/attributes/TANGENT").is_some());
    let source = PageSource {
        count: positions.count,
        stored_tangents: build.stored_tangents,
        made_normals,
        mesh_tangents,
    };
    let attributes = super::pages::record::page_attributes(g, bin, p, source, validated)?;
    crate::geometry_page::deform::declare_soft(&mut deformation, g, old, &pos)?;
    // Every texture set the primitive has, read by its material or not.
    let carried: Vec<&encode::Attribute> = attributes.iter().collect();
    // The DAG carries the bones beside them, which no page reads from there.
    let bones = crate::dag::attributes::bones(&deformation);
    let carried: Vec<&encode::Attribute> = carried.into_iter().chain(&bones).collect();
    let encode = |slice: &[u32], pos: &[f32], carried: &[&_], origin: &[u32], grid: PageGrid| {
        super::pages::record::encode_page(slice, (pos, carried), (&deformation, origin), grid)
    };
    // Every primitive joins the DAG, a blended one too, transmissive or not: its draw order is
    // restored at runtime from the recorded source rank, so spatial clustering does not scramble
    // the blend order, and the water pass composes its pages over the backdrop as any.
    let scale = mesh_scales.get(&old).copied();
    let demand = crate::proxy::cut::cut_demand(
        scale,
        trillion3d_page_codec::proxy::PROXY_TRIANGLE_BUDGET,
        triangle_count,
        *scene_triangles,
    );
    // What the merged layers take of it, when one may take it.
    let taken = merged
        .contains(&old)
        .then(|| crate::hlod::chain::merged_lods(o))
        .flatten();
    let DagResult {
        pages,
        cluster_planes,
        proxy_cut,
        proxy_threshold,
        page_run,
        dag_report,
        timings,
        warnings,
        culling_report,
        structure_report,
        collision,
        source_cover,
        voxel_seed,
    } = build_dag_primitive(
        o,
        &pos,
        &carried,
        &index_values,
        (demand, taken),
        (shaping, build.root_pages),
        (build.precision, scale),
        &encode,
    )?;
    let event = primitive_event(mesh, primitive, pages.len(), timings, warnings);
    progress(event);
    let reach = crate::geometry_page::deform::reach(&deformation, &pos);
    Ok(CompiledPrimitive {
        page_run,
        cluster_planes,
        proxy_cut,
        collision,
        source_cover,
        voxel_seed,
        proxy_threshold: proxy_threshold * scale.unwrap_or(1.0), // back in metres for the report
        value: json!({"mesh":mesh,"primitive":primitive,"material":p.get("material").cloned().unwrap_or(Value::Null),"triangles":triangle_count,"pass":if blended {"clustered-blend"} else {"exact-clusters"},"clusterStrategy":DAG_CLUSTER_STRATEGY,"dag":dag_report,"culling":culling_report,"structure":structure_report,"pages":pages,"deformation":reach}),
    })
}
