use super::*;
use crate::compiler_primitive_warn::primitive_event;

pub(super) struct PrimitiveInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_values: &'a [Value],
    pub skinned_meshes: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
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

/// A compiled primitive and, beside it, the plane of each of its clusters. The planes never reach
/// the cache on their own: the coplanar stage reads them once every primitive is done.
pub(super) struct CompiledPrimitive {
    pub value: Value,
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// Vertices of the resident proxy coarse cut, in object space.
    pub proxy_cut: Vec<f32>,
    /// The threshold, in metres, that this cut requested.
    pub proxy_threshold: f64,
}

pub(super) fn compile_primitive(
    inputs: &PrimitiveInputs<'_>,
    old: &usize,
    primitive: &usize,
) -> Result<CompiledPrimitive> {
    let PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values,
        skinned_meshes,
        mesh_map,
        mesh_scales,
        scene_triangles,
        validated,
        progress,
    } = inputs;
    check(o)?;
    let p = item(
        values(item(mesh_values, *old, "mesh")?, "primitives")?,
        *primitive,
        "primitive",
    )?;
    if optional_index(p.get("mode"), "primitive.mode", 4)? != 4 {
        return Err(CompilerError::new(
            "UNSUPPORTED_PRIMITIVE",
            "Only static triangles are supported",
        ));
    }
    let positions = accessor(
        g,
        bin,
        required_index(
            p.get("attributes")
                .and_then(Value::as_object)
                .and_then(|a| a.get("POSITION")),
            "primitive.attributes.POSITION",
        )?,
        Some(validated),
    )?;
    if positions.width != 3 || positions.component != 5126 {
        return Err(invalid("POSITION must be float VEC3"));
    }
    let (index_values, triangle_count) = if p.get("indices").is_some() {
        let ids = accessor(
            g,
            bin,
            required_index(p.get("indices"), "primitive.indices")?,
            Some(validated),
        )?;
        if ids.width != 1 || ids.normalized || ![5121, 5123, 5125].contains(&ids.component) {
            return Err(invalid("indices component must be unsigned SCALAR"));
        }
        if ids.count == 0 || ids.count % 3 != 0 {
            return Err(CompilerError::new(
                "INVALID_TRIANGLES",
                "Index count must be a positive multiple of three",
            ));
        }
        (ids.collect_u32()?, ids.count / 3)
    } else {
        if positions.count == 0 || positions.count % 3 != 0 {
            return Err(invalid(
                "Unindexed POSITION count must be a positive multiple of three",
            ));
        }
        ((0..positions.count as u32).collect(), positions.count / 3)
    };
    let pos = {
        let _t = perf::Timer::new(perf::Phase::Decode);
        positions.collect_f32()?
    };
    let topology = {
        let _t = perf::Timer::new(perf::Phase::Topology);
        crate::topology::classify_topology(&index_values, positions.count)?
    };
    let is_skinned_or_morph = p.get("targets").is_some()
        || skinned_meshes.contains(old)
        || p.get("attributes")
            .and_then(Value::as_object)
            .map(|a| a.contains_key("JOINTS_0") || a.contains_key("WEIGHTS_0"))
            .unwrap_or(false);
    let material = if let Some(material) = p.get("material") {
        let id = required_index(Some(material), "primitive.material")?;
        values(g, "materials")?.get(id)
    } else {
        None
    };
    let unsplit = is_skinned_or_morph || unsplit_material(material);
    let clustered_blend = !unsplit
        && material
            .and_then(|m| m.get("alphaMode"))
            .and_then(Value::as_str)
            == Some("BLEND");
    let mesh = *mesh_map
        .get(old)
        .ok_or_else(|| invalid("Missing mesh mapping"))?;
    let mut attributes = Vec::<geometry_page::Attribute>::new();
    if !unsplit {
        for &(name, width, flag) in &geometry_page::PAGE_ATTRIBUTES {
            if let Some(id) = p
                .get("attributes")
                .and_then(Value::as_object)
                .and_then(|attributes| attributes.get(name))
            {
                let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
                if a.count != positions.count
                    || (a.width != width && !(name == "COLOR_0" && a.width == 3))
                {
                    return Err(CompilerError::new(
                        "INVALID_PAGE_ATTRIBUTE",
                        format!("{name} count or width differs from POSITION"),
                    ));
                }
                attributes.push(geometry_page::Attribute {
                    flag,
                    width: a.width,
                    values: a.collect_f32()?,
                });
            }
        }
    }
    let carried = carried_attributes(&attributes, material);
    let store_packed = |slice: &[u32], position_exponent: i32| -> Result<(Value, bool)> {
        compiler_page_object::store_page(o, slice, &pos, &carried, position_exponent)
    };
    // Transparent primitives join the DAG too: their draw order is restored at runtime from the
    // recorded source rank, so spatial clustering no longer scrambles the blend order.
    let dag_primitive = !unsplit;
    let scale = mesh_scales.get(old).copied();
    let demand = crate::proxy::cut::cut_demand(
        scale,
        crate::proxy::PROXY_TRIANGLE_BUDGET,
        triangle_count,
        *scene_triangles,
    );
    let DagResult {
        pages,
        cluster_planes,
        proxy_cut,
        proxy_threshold,
        reused,
        dag_report,
        timings,
        warnings,
        culling_report,
        structure_report,
        stream_report,
        position_exponent,
    } = if dag_primitive {
        build_dag_primitive(o, &pos, &carried, &index_values, demand, &store_packed)?
    } else {
        DagResult::default()
    };
    let event = primitive_event(mesh, *primitive, pages.len(), timings, warnings);
    progress(event);
    let quantization = compiler_page_object::quantization_report(&pages, position_exponent);
    Ok(CompiledPrimitive {
        cluster_planes,
        proxy_cut,
        // The threshold is back in object space: it goes out in metres for the report.
        proxy_threshold: proxy_threshold * scale.unwrap_or(1.0),
        value: json!({"mesh":mesh,"primitive":primitive,"material":p.get("material").cloned().unwrap_or(Value::Null),"triangles":triangle_count,"pass":if unsplit{"shared-blend"}else if clustered_blend{"clustered-blend"}else{"exact-clusters"},"clusterStrategy":if dag_primitive{json!(DAG_CLUSTER_STRATEGY)}else{Value::Null},"hierarchy":Value::Null,"dag":dag_report,"culling":culling_report,"structure":structure_report,"streams":stream_report,"pages":pages,"quantization":quantization,"reusedPages":reused,"topology":{"triangles":topology.triangles,"edges":{"boundary":topology.boundary_edges,"manifold":topology.manifold_edges,"nonManifold":topology.non_manifold_edges},"vertices":{"interior":topology.interior_vertices,"boundary":topology.boundary_vertices,"locked":topology.locked_vertices,"unused":topology.unused_vertices},"manifold":topology.manifold}}),
    })
}
