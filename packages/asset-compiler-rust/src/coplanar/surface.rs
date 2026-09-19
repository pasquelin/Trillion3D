use super::*;

/// One opaque surface of the scene: the clusters of a single primitive instance that share a world
/// plane. This is the unit the stage orders — a whole surface goes above or below another, never a
/// cluster on its own, so a triangulation seam can never split the winner.
pub struct Surface {
    pub node: usize,
    /// Compiled mesh and the index of the primitive inside the compiled list.
    pub mesh: usize,
    pub primitive: usize,
    pub material: i64,
    pub priority: i64,
    /// Source rank used to break an area tie: the later object goes on top.
    pub order: usize,
    pub normal: [f64; 3],
    pub offset: f64,
    pub key: [i64; 4],
    pub area: f64,
    pub low: [f64; 3],
    pub high: [f64; 3],
    /// Page indices inside the primitive, coarse levels included: a fallback cluster covers the same
    /// surface and must be biased the same way.
    pub pages: Vec<usize>,
    pub exact_pages: usize,
}

/// Node instances between two progress events. Small enough to see a large scene move, large enough
/// that the events cost nothing next to the work they describe.
const PROGRESS_STEP: usize = 256;

fn opaque_exact(primitive: &Value, materials: &[Value]) -> bool {
    if primitive.get("pass").and_then(Value::as_str) != Some("exact-clusters") {
        return false;
    }
    let Some(id) = primitive.get("material").and_then(Value::as_u64) else {
        // A primitive with no material is drawn with the default opaque material.
        return primitive.get("material").is_none_or(Value::is_null);
    };
    let Some(material) = materials.get(id as usize) else {
        return false;
    };
    // MASK cuts its own holes per pixel: biasing it would move a cutout against the surface it
    // shares a plane with. BLEND never reaches this stage at all.
    matches!(
        material.get("alphaMode").and_then(Value::as_str),
        None | Some("OPAQUE")
    ) && !unsplit_material(Some(material))
}

fn priority_of(node: &Value, mesh: Option<&Value>) -> i64 {
    let read = |value: Option<&Value>| {
        value
            .and_then(|extras| extras.get("coplanarPriority"))
            .and_then(Value::as_i64)
    };
    read(node.get("extras"))
        .or_else(|| read(mesh.and_then(|mesh| mesh.get("extras"))))
        .unwrap_or(0)
}

/// Every opaque surface of the selected scene. Bounded work: a primitive instance keeps at most
/// `max_planes_per_primitive` planes, the largest ones by area, and reports what it dropped.
pub fn collect(
    inputs: &CoplanarInputs<'_>,
    bounds: &CoplanarBounds,
    dropped: &mut usize,
) -> Result<Vec<Surface>> {
    let world = crate::compiler_world::world_matrices(inputs.g)?;
    collect_with_world(inputs, bounds, dropped, &world)
}

/// Same collection, with world matrices already built by the step.
pub fn collect_with_world(
    inputs: &CoplanarInputs<'_>,
    bounds: &CoplanarBounds,
    dropped: &mut usize,
    world: &[crate::compiler_world::Mat4],
) -> Result<Vec<Surface>> {
    let nodes = values(inputs.g, "nodes")?;
    let meshes = values(inputs.g, "meshes")?;
    let materials = inputs
        .g
        .get("materials")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut surfaces: Vec<Surface> = Vec::new();
    for (order, node_id) in inputs.chosen.iter().enumerate() {
        (inputs.cancelled)()?;
        if order % PROGRESS_STEP == 0 {
            (inputs.progress)(
                json!({"phase":"coplanar","step":"surfaces","completed":order,"total":inputs.chosen.len()}),
            );
        }
        let node = item(nodes, *node_id, "node")?;
        let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
        let Some(mesh_index) = inputs.mesh_map.get(&old_mesh).copied() else {
            continue;
        };
        let priority = priority_of(node, meshes.get(old_mesh));
        let matrix = world[*node_id];
        for (primitive_index, primitive) in inputs.primitives.iter().enumerate() {
            if primitive.get("mesh").and_then(Value::as_u64) != Some(mesh_index as u64)
                || !opaque_exact(primitive, &materials)
            {
                continue;
            }
            let mut drafts: BTreeMap<[i64; 4], Surface> = BTreeMap::new();
            let planes = &inputs.cluster_planes[primitive_index];
            let pages = primitive
                .get("pages")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let material = primitive
                .get("material")
                .and_then(Value::as_i64)
                .unwrap_or(-1);
            for (page_index, page) in pages.iter().enumerate() {
                let Some(Some(plane)) = planes.get(page_index) else {
                    continue;
                };
                let Some((normal, offset, scale)) = placement::world_plane(&matrix, plane) else {
                    continue;
                };
                let key = plane::plane_key(normal, offset, inputs.offset_quantum);
                let surface = drafts.entry(key).or_insert_with(|| Surface {
                    node: *node_id,
                    mesh: mesh_index,
                    primitive: primitive_index,
                    material,
                    priority,
                    order,
                    normal,
                    offset,
                    key,
                    area: 0.0,
                    low: [f64::INFINITY; 3],
                    high: [f64::NEG_INFINITY; 3],
                    pages: Vec::new(),
                    exact_pages: 0,
                });
                surface.pages.push(page_index);
                if page.get("role").and_then(Value::as_str) != Some("coarse") {
                    surface.exact_pages += 1;
                    surface.area += plane.area * scale;
                    placement::extend_box(surface, page, &matrix);
                }
            }
            let mut collected: Vec<Surface> = drafts
                .into_values()
                .filter(|surface| surface.exact_pages > 0 && surface.area > 0.0)
                .collect();
            collected.sort_by(|a, b| b.area.total_cmp(&a.area).then(a.key.cmp(&b.key)));
            if collected.len() > bounds.max_planes_per_primitive {
                *dropped += collected.len() - bounds.max_planes_per_primitive;
                collected.truncate(bounds.max_planes_per_primitive);
            }
            surfaces.append(&mut collected);
        }
    }
    surfaces.sort_by_key(|surface| (surface.key, surface.order, surface.primitive));
    Ok(surfaces)
}
