//! Build items and component instances share meshes and retain local transforms.
use super::*;
struct World<'a, 'd, 'r> {
    objects: BTreeMap<usize, Node<'a, 'd>>,
    groups: materials::Groups,
    meshes: BTreeMap<usize, usize>,
    visiting: BTreeSet<usize>,
    scene: &'r mut SceneTables,
    request: &'r SceneRequest<'r>,
}
fn transform(node: Node<'_, '_>) -> Result<[f64; 16]> {
    let Some(value) = node.attribute("transform") else {
        return Ok(crate::compiler_world::IDENTITY);
    };
    let v: Vec<f64> = value
        .split_whitespace()
        .map(|s| {
            s.parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
                .ok_or_else(|| source::invalid("3mf", "invalid transform number"))
        })
        .collect::<Result<_>>()?;
    if v.len() != 12 {
        return Err(source::invalid("3mf", "transform needs twelve values"));
    }
    Ok([
        v[0], v[1], v[2], 0., v[3], v[4], v[5], 0., v[6], v[7], v[8], 0., v[9], v[10], v[11], 1.,
    ])
}
impl World<'_, '_, '_> {
    fn instance(&mut self, item: Node<'_, '_>) -> Result<usize> {
        if self
            .request
            .cancelled
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err(super::super::cancel::refusal());
        }
        if item.attributes().any(|a| a.namespace().is_some()) {
            return Err(source::unsupported(
                "3mf",
                "extended component/build attributes",
            ));
        }
        let id = xml::usize_attribute(item, "objectid", "3mf")?;
        let object = *self
            .objects
            .get(&id)
            .ok_or_else(|| source::invalid("3mf", "unknown object reference"))?;
        if self.visiting.len() >= 256 || !self.visiting.insert(id) {
            return Err(source::invalid("3mf", "component cycle or excessive depth"));
        }
        let mut node =
            json!({"name":object.attribute("name").unwrap_or("object"),"matrix":transform(item)?});
        match (xml::child(object, "mesh"), xml::child(object, "components")) {
            (Some(_), None) => {
                let rank = if let Some(rank) = self.meshes.get(&id) {
                    *rank
                } else {
                    let rank = mesh::read(object, &self.groups, self.request, self.scene)?;
                    self.meshes.insert(id, rank);
                    rank
                };
                node["mesh"] = json!(rank);
            }
            (None, Some(components)) => {
                let mut children = Vec::new();
                for component in components.children().filter(|n| n.is_element()) {
                    if !component.has_tag_name((CORE, "component")) {
                        return Err(source::unsupported("3mf", "non-core component"));
                    }
                    children.push(self.instance(component)?);
                }
                if children.is_empty() {
                    return Err(source::invalid("3mf", "empty component object"));
                }
                node["children"] = json!(children);
            }
            _ => {
                return Err(source::invalid(
                    "3mf",
                    "object needs either mesh or components",
                ))
            }
        }
        self.visiting.remove(&id);
        Ok(self.scene.node(node))
    }
}
pub(super) fn read(
    root: Node<'_, '_>,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    if !root.has_tag_name((CORE, "model")) {
        return Err(source::invalid("3mf", "missing Core model root"));
    }
    for prefix in root
        .attribute("requiredextensions")
        .unwrap_or("")
        .split_whitespace()
    {
        if !matches!(
            root.lookup_namespace_uri(Some(prefix)),
            Some(CORE) | Some(MATERIALS)
        ) {
            return Err(source::unsupported(
                "3mf",
                format!("required extension {prefix}"),
            ));
        }
    }
    let unit = match root.attribute("unit").unwrap_or("millimeter") {
        "micron" => 1e-6,
        "millimeter" => 0.001,
        "centimeter" => 0.01,
        "inch" => 0.0254,
        "foot" => 0.3048,
        "meter" => 1.,
        other => return Err(source::unsupported("3mf", format!("unit {other}"))),
    };
    let resources = xml::required(root, "resources", "3mf")?;
    let mut ids = BTreeSet::new();
    let mut objects = BTreeMap::new();
    for resource in resources.children().filter(|n| n.is_element()) {
        let id = xml::usize_attribute(resource, "id", "3mf")?;
        if id == 0 || !ids.insert(id) {
            return Err(source::invalid("3mf", "zero or duplicate resource ID"));
        }
        if resource.has_tag_name((CORE, "object")) {
            objects.insert(id, resource);
        }
    }
    let groups = materials::load(resources, scene)?;
    let mut world = World {
        objects,
        groups,
        meshes: BTreeMap::new(),
        visiting: BTreeSet::new(),
        scene,
        request,
    };
    let mut children = Vec::new();
    for item in xml::required(root, "build", "3mf")?
        .children()
        .filter(|n| n.is_element())
    {
        if !item.has_tag_name((CORE, "item")) {
            return Err(source::unsupported("3mf", "non-core build item"));
        }
        children.push(world.instance(item)?);
    }
    if children.is_empty() {
        return Err(source::invalid("3mf", "empty build"));
    }
    world.scene.node(json!({"name":"3MF coordinate system","matrix":[unit,0.,0.,0.,0.,0.,-unit,0.,0.,unit,0.,0.,0.,0.,0.,1.],"children":children}));
    Ok(())
}
