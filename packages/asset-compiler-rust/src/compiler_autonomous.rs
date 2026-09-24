use super::*;

/// What this format does not carry: node animation, skinning, morph weights.
/// Announcing them then stripping them would promise the consumer a scene it would
/// not have recognised; the whole mode is refused for those scenes, and that
/// refusal is counted under this name.
pub(super) const ANIMATED: &str = "autonomous-scene-animated";
/// The name the autonomous document is published under, and the one its tables are keyed by.
pub(super) const AUTONOMOUS_SCENE_FILE: &str = "scene.gltf";

/// Does the source scene declare motion or deformation? An empty animation or
/// skinning declares nothing: what the file carries decides, not the presence of
/// the array.
fn deformed(source: &Value) -> bool {
    let declared = |name: &str| {
        source
            .get(name)
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
    };
    declared("animations")
        || declared("skins")
        || source
            .get("nodes")
            .and_then(Value::as_array)
            .is_some_and(|nodes| {
                nodes
                    .iter()
                    .any(|node| node.get("skin").is_some() || node.get("weights").is_some())
            })
}

/// What writing the autonomous scene yields: its name for the manifest (or `null`), the named reason
/// it was refused, the document itself, and the products written.
type AutonomousScene = (Value, Option<&'static str>, Option<Value>, Vec<Product>);

/// The self-contained glTF a host loads when it draws the cache without the source: same nodes,
/// same materials, same images, but every primitive reduced to a single degenerate triangle. The
/// geometry itself comes from the cluster pages. `Value::Null` when the cache is not eligible, with
/// the named reason when it is the source's own movement that puts it out of reach.
/// The document itself and the products written, `scene.bin` then `scene.gltf`, come with it.
pub(super) fn write_autonomous_scene(
    directory: &Path,
    source: &Value,
    primitives: &[Value],
    output_views: &[Value],
) -> Result<AutonomousScene> {
    if !primitives.is_empty()
        && primitives
            .iter()
            .all(|primitive| primitive["pass"] == "exact-clusters")
    {
        if deformed(source) {
            return Ok((Value::Null, Some(ANIMATED), None, Vec::new()));
        }
        let mut scene = source.clone();
        let mut scene_bytes = vec![0u8; 44];
        for (i, value) in [0u16, 1, 2].iter().enumerate() {
            scene_bytes[36 + i * 2..38 + i * 2].copy_from_slice(&value.to_le_bytes());
        }
        let mut scene_views = vec![
            json!({"buffer":0,"byteOffset":0,"byteLength":36}),
            json!({"buffer":0,"byteOffset":36,"byteLength":6}),
        ];
        let mut source_binary = File::open(directory.join("source.bin"))?;
        if let Some(images) = scene.get_mut("images").and_then(Value::as_array_mut) {
            for image in images {
                if let Some(old) = image.get("bufferView") {
                    let id = required_index(Some(old), "image.bufferView")?;
                    let view = item(output_views, id, "image bufferView")?;
                    let start = required_index(view.get("byteOffset"), "image.byteOffset")?;
                    let length = required_index(view.get("byteLength"), "image.byteLength")?;
                    scene_bytes.resize(
                        scene_bytes.len() + shared_math::pad_to_4(scene_bytes.len()),
                        0,
                    );
                    let at = scene_bytes.len();
                    let end = at
                        .checked_add(length)
                        .ok_or_else(|| invalid("Image view too large"))?;
                    scene_bytes.resize(end, 0);
                    source_binary.seek(SeekFrom::Start(start as u64))?;
                    source_binary.read_exact(&mut scene_bytes[at..end])?;
                    image["bufferView"] = json!(scene_views.len());
                    scene_views.push(json!({"buffer":0,"byteOffset":at,"byteLength":length}));
                }
            }
        }
        scene["buffers"] = json!([{"uri":"scene.bin","byteLength":scene_bytes.len()}]);
        scene["bufferViews"] = Value::Array(scene_views);
        scene["accessors"] = json!([{"bufferView":0,"componentType":5126,"type":"VEC3","count":3,"min":[0,0,0],"max":[0,0,0]},{"bufferView":1,"componentType":5123,"type":"SCALAR","count":3}]);
        if let Some(meshes) = scene.get_mut("meshes").and_then(Value::as_array_mut) {
            for mesh in meshes {
                if let Some(parts) = mesh.get_mut("primitives").and_then(Value::as_array_mut) {
                    for part in parts {
                        let material = part.get("material").cloned();
                        *part = json!({"mode":4,"attributes":{"POSITION":0},"indices":1});
                        if let Some(material) = material {
                            part["material"] = material;
                        }
                    }
                }
            }
        }
        let products = vec![
            product(directory, "scene.bin", &scene_bytes)?,
            product(
                directory,
                AUTONOMOUS_SCENE_FILE,
                &serde_json::to_vec(&scene)?,
            )?,
        ];
        return Ok((json!(AUTONOMOUS_SCENE_FILE), None, Some(scene), products));
    }
    Ok((Value::Null, None, None, Vec::new()))
}
