//! Products retain STEP/GlobalId identities and share identical representation items.
use super::*;
use crate::compiler_world::{multiply, Mat4, IDENTITY};
fn context(all: &Entities, id: u32) -> Result<Mat4> {
    let e = entity(all, id)?;
    match e.kind.as_str() {
        "IFCGEOMETRICREPRESENTATIONCONTEXT" => {
            if e.data.get(2).and_then(Value::as_int) != Some(3) {
                return Err(source::unsupported("ifc", "non-3D representation context"));
            }
            placement::axis(all, reference(&e.data, 4)?)
        }
        "IFCGEOMETRICREPRESENTATIONSUBCONTEXT" => {
            let parent = entity(all, reference(&e.data, 6)?)?;
            if parent.kind != "IFCGEOMETRICREPRESENTATIONCONTEXT" {
                return Err(source::unsupported(
                    "ifc",
                    "nested representation subcontext",
                ));
            }
            context(all, parent.data.id)
        }
        _ => Err(source::unsupported(
            "ifc",
            format!("representation context {}", e.kind),
        )),
    }
}
pub(super) fn read(
    all: &Entities,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    for e in all.values() {
        if [
            "IFCRELVOIDSELEMENT",
            "IFCRELASSOCIATESMATERIAL",
            "IFCINDEXEDCOLOURMAP",
            "IFCINDEXEDTRIANGLETEXTUREMAP",
            "IFCMAPCONVERSION",
            "IFCMAPCONVERSIONSCALED",
        ]
        .contains(&e.kind.as_str())
        {
            return Err(source::unsupported(
                "ifc",
                format!(
                    "{} requires additional appearance/geometry semantics",
                    e.kind
                ),
            ));
        }
    }
    let scale = placement::units(all)?;
    let styles = styles::read(all, scene)?;
    let mut meshes = BTreeMap::new();
    let mut roots = Vec::new();
    let mut corners = 0usize;
    for product in all.values() {
        let Some(shape) = product
            .data
            .get_ref(6)
            .and_then(|id| all.get(&id))
            .filter(|e| e.kind == "IFCPRODUCTDEFINITIONSHAPE")
        else {
            continue;
        };
        if super::super::cancel::stopped(request.cancelled, 0) {
            return Err(super::super::cancel::refusal());
        }
        let pose = placement::local(all, product.data.get_ref(5))?;
        let mut children = Vec::new();
        for value in list(&shape.data, 2)? {
            let representation = entity(
                all,
                value
                    .as_entity_ref()
                    .ok_or_else(|| invalid("representation is not reference"))?,
            )?;
            if representation.kind != "IFCSHAPEREPRESENTATION" {
                return Err(source::unsupported("ifc", &representation.kind));
            }
            let frame = context(all, reference(&representation.data, 0)?)?;
            let mut parts = Vec::new();
            for value in list(&representation.data, 3)? {
                let id = value
                    .as_entity_ref()
                    .ok_or_else(|| invalid("geometry item is not reference"))?;
                let e = entity(all, id)?;
                let rank = if let Some(rank) = meshes.get(&id) {
                    *rank
                } else {
                    let vertices = surface::read(all, e, request)?;
                    corners = corners
                        .checked_add(vertices.count())
                        .ok_or_else(|| invalid("output corner count overflow"))?;
                    source::admit(corners.saturating_mul(96), request.ram_budget / 2, "ifc")?;
                    let mesh = source::mesh_bounded(
                        scene,
                        &format!("{}-#{id}", e.kind),
                        &[(vertices, styles.get(&id).copied())],
                        request,
                    )?;
                    meshes.insert(id, mesh);
                    mesh
                };
                parts.push(scene.node(json!({"name":format!("item-#{id}"),"mesh":rank,"extras":{"ifcRepresentationItem":id}})));
            }
            if parts.is_empty() {
                return Err(invalid("empty shape representation"));
            }
            children.push(scene.node(json!({"name":representation.data.get_string(1).unwrap_or("representation"),"matrix":multiply(&frame,&pose),"children":parts})));
        }
        let global = product
            .data
            .get_string(0)
            .ok_or_else(|| invalid("product has no GlobalId"))?;
        roots.push(scene.node(json!({"name":product.data.get_string(2).unwrap_or(global),"matrix":IDENTITY,"children":children,"extras":{"ifcExpressId":product.data.id,"ifcGlobalId":global,"ifcType":product.kind}})));
    }
    if roots.is_empty() {
        return Err(invalid("no product with supported shape"));
    }
    scene.node(json!({"name":"IFC coordinate system","matrix":[scale,0.,0.,0.,0.,0.,-scale,0.,0.,scale,0.,0.,0.,0.,0.,1.],"children":roots}));
    Ok(())
}
