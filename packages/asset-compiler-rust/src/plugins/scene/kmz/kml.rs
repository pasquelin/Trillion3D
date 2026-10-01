//! KML resolves only package-local Model links; imagery remains under the guarded extraction.
use super::super::mesh_source::xml;
use super::*;
use serde_json::json;
const KML: &str = "http://www.opengis.net/kml/2.2";
pub(super) fn read(root: &Path, request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let file = root.join("doc.kml");
    source::admit(
        usize::try_from(fs::metadata(&file)?.len()).unwrap_or(usize::MAX),
        request.ram_budget / 8,
        "kmz",
    )?;
    let bytes = fs::read(&file)?;
    let document = xml::parse(&bytes, request, "kmz")?;
    let element = document.root_element();
    if !element.has_tag_name((KML, "kml")) {
        return Err(source::invalid("kmz", "expected KML2.2 root"));
    }
    for node in element.descendants().filter(|n| n.is_element()) {
        if [
            "NetworkLink",
            "GroundOverlay",
            "ScreenOverlay",
            "PhotoOverlay",
            "Point",
            "LineString",
            "Polygon",
            "Track",
            "ResourceMap",
        ]
        .contains(&node.tag_name().name())
        {
            return Err(source::unsupported("kmz", node.tag_name().name()));
        }
    }
    let mut origin = None;
    for model in element
        .descendants()
        .filter(|n| n.has_tag_name((KML, "Model")))
    {
        archive::check(request)?;
        let position = placement::location(model)?;
        let anchor = *origin.get_or_insert(position);
        let href = xml::required(xml::required(model, "Link", "kmz")?, "href", "kmz")?
            .text()
            .unwrap_or("")
            .trim();
        let file = crate::uri::resolve_under(root, href).map_err(|e| source::invalid("kmz", e))?;
        if file
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("dae"))
        {
            return Err(source::unsupported("kmz", "Model link is not COLLADA"));
        }
        source::admit(
            usize::try_from(fs::metadata(&file)?.len()).unwrap_or(usize::MAX),
            request.ram_budget / 8,
            "kmz",
        )?;
        let data = fs::read(&file)?;
        scene.read_file(href, data.len(), &crate::hash(&data));
        let (start, image_start) = (scene.nodes.len(), scene.images.len());
        let inputs = [file.clone()];
        let inner = SceneRequest {
            source: &file,
            inputs: &inputs,
            cache: request.cache,
            cancelled: request.cancelled,
            progress: request.progress,
            ram_budget: request.ram_budget,
        };
        super::super::collada::read(&data, &inner, scene)?;
        let mut child = std::collections::BTreeSet::new();
        for node in &scene.nodes[start..] {
            for id in node["children"].as_array().into_iter().flatten() {
                if let Some(id) = id.as_u64() {
                    child.insert(id as usize);
                }
            }
        }
        let roots: Vec<_> = (start..scene.nodes.len())
            .filter(|id| !child.contains(id))
            .collect();
        for image in &mut scene.images[image_start..] {
            let uri = image["uri"]
                .as_str()
                .ok_or_else(|| source::invalid("kmz", "COLLADA image has no URI"))?;
            let absolute = crate::uri::resolve_under(&super::super::image_root(&file), uri)
                .map_err(|e| source::invalid("kmz", e))?;
            let relative = absolute
                .strip_prefix(root)
                .map_err(|e| source::invalid("kmz", e))?;
            image["uri"] = json!(relative.to_string_lossy());
        }
        scene.node(json!({"name":"KML Model","matrix":placement::matrix(model,position,anchor)?,"children":roots,"extras":{"longitude":position[0],"latitude":position[1],"altitude":position[2],"localWgs84Origin":anchor}}));
    }
    if origin.is_none() {
        return Err(source::invalid("kmz", "doc.kml has no Model"));
    }
    Ok(())
}
