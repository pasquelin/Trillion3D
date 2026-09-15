//! Verser un modèle déjà converti dans la scène en construction.
//!
//! Un modèle référencé par la scène Unity est lu par le pilote de son format — jamais par celui-ci —
//! et rend un glTF complet. Le verser ici, c'est recopier ses tables en décalant chaque rang, une
//! seule fois par modèle : les instances suivantes réutilisent les mêmes maillages. Aucun sommet
//! n'est retouché, aucune image n'est réencodée ; seules les URI des images changent, pour rester
//! relatives au dossier servi.
use super::*;

/// Ce qu'un modèle versé laisse à instancier : ses nœuds porteurs de maillage.
#[derive(Clone)]
pub(super) struct Parts {
    /// Nom, matrice locale telle que le modèle la donne, rang du maillage dans la scène.
    pub(super) nodes: Vec<(String, Value, usize)>,
}

/// Recopie les tables du modèle dans la scène. `prefix` est le chemin du dossier du modèle,
/// relativement au dossier servi : les images du modèle y sont nommées.
pub(super) fn merge(gltf: &Value, buffers: &[Vec<u8>], prefix: &str, scene: &mut Scene) -> Parts {
    let views = merge_views(gltf, buffers, scene);
    let accessors = merge_accessors(gltf, &views, scene);
    let images = merge_images(gltf, prefix, &views, scene);
    let samplers = merge_samplers(gltf, scene);
    let textures = merge_textures(gltf, &images, &samplers, scene);
    let materials = merge_materials(gltf, &textures, scene);
    merge_meshes(gltf, &accessors, &materials, scene)
}

fn array<'a>(gltf: &'a Value, name: &str) -> &'a [Value] {
    gltf[name].as_array().map_or(&[][..], Vec::as_slice)
}
fn index(value: &Value, map: &[usize]) -> Option<usize> {
    map.get(value.as_u64()? as usize).copied()
}

fn merge_views(gltf: &Value, buffers: &[Vec<u8>], scene: &mut Scene) -> Vec<usize> {
    let mut map = Vec::new();
    for view in array(gltf, "bufferViews") {
        let buffer = view["buffer"].as_u64().unwrap_or(0) as usize;
        let offset = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        let length = view["byteLength"].as_u64().unwrap_or(0) as usize;
        let bytes = buffers
            .get(buffer)
            .and_then(|data| data.get(offset..offset + length))
            .unwrap_or(&[]);
        let target = view["target"].as_u64().map(|value| value as u32);
        let id = scene.bin.view(bytes, target);
        if let Some(stride) = view.get("byteStride") {
            scene.bin.views[id]["byteStride"] = stride.clone();
        }
        map.push(id);
    }
    map
}

fn merge_accessors(gltf: &Value, views: &[usize], scene: &mut Scene) -> Vec<usize> {
    let mut map = Vec::new();
    for accessor in array(gltf, "accessors") {
        let mut copy = accessor.clone();
        match index(&accessor["bufferView"], views) {
            Some(view) => copy["bufferView"] = json!(view),
            None => {
                copy.as_object_mut()
                    .map(|fields| fields.remove("bufferView"));
            }
        }
        scene.accessors.push(copy);
        map.push(scene.accessors.len() - 1);
    }
    map
}

fn merge_images(gltf: &Value, prefix: &str, views: &[usize], scene: &mut Scene) -> Vec<usize> {
    let mut map = Vec::new();
    for image in array(gltf, "images") {
        let mut copy = image.clone();
        if let Some(uri) = image["uri"].as_str() {
            copy["uri"] = json!(if prefix.is_empty() {
                uri.to_string()
            } else {
                format!("{prefix}/{uri}")
            });
        }
        if let Some(view) = index(&image["bufferView"], views) {
            copy["bufferView"] = json!(view);
        }
        scene.images.push(copy);
        map.push(scene.images.len() - 1);
    }
    map
}

fn merge_samplers(gltf: &Value, scene: &mut Scene) -> Vec<usize> {
    array(gltf, "samplers")
        .iter()
        .map(|sampler| {
            scene.samplers.push(sampler.clone());
            scene.samplers.len() - 1
        })
        .collect()
}

fn merge_textures(
    gltf: &Value,
    images: &[usize],
    samplers: &[usize],
    scene: &mut Scene,
) -> Vec<usize> {
    let mut map = Vec::new();
    for texture in array(gltf, "textures") {
        let mut copy = texture.clone();
        if let Some(source) = index(&texture["source"], images) {
            copy["source"] = json!(source);
        }
        if let Some(sampler) = index(&texture["sampler"], samplers) {
            copy["sampler"] = json!(sampler);
        }
        scene.textures.push(copy);
        map.push(scene.textures.len() - 1);
    }
    map
}

fn merge_materials(gltf: &Value, textures: &[usize], scene: &mut Scene) -> Vec<usize> {
    let mut map = Vec::new();
    for material in array(gltf, "materials") {
        let mut copy = material.clone();
        retarget_textures(&mut copy, textures);
        scene.materials.push(copy);
        map.push(scene.materials.len() - 1);
    }
    map
}

/// Décale chaque renvoi de texture d'un matériau : toute propriété nommée `…Texture` porte un
/// `index` dans la table des textures, quelle que soit sa place dans le document.
fn retarget_textures(value: &mut Value, textures: &[usize]) {
    match value {
        Value::Object(fields) => {
            for (key, item) in fields.iter_mut() {
                if key.ends_with("Texture") {
                    if let Some(target) = index(&item["index"], textures) {
                        item["index"] = json!(target);
                    }
                }
                retarget_textures(item, textures);
            }
        }
        Value::Array(items) => items
            .iter_mut()
            .for_each(|item| retarget_textures(item, textures)),
        _ => {}
    }
}

fn merge_meshes(
    gltf: &Value,
    accessors: &[usize],
    materials: &[usize],
    scene: &mut Scene,
) -> Parts {
    let mut map = Vec::new();
    for mesh in array(gltf, "meshes") {
        let mut copy = mesh.clone();
        let mut triangles = 0usize;
        for primitive in copy["primitives"].as_array_mut().map_or(&mut [][..], |p| p) {
            if let Some(attributes) = primitive["attributes"].as_object_mut() {
                for (_, value) in attributes.iter_mut() {
                    if let Some(target) = index(value, accessors) {
                        *value = json!(target);
                    }
                }
            }
            if let Some(target) = index(&primitive["indices"], accessors) {
                primitive["indices"] = json!(target);
                triangles += scene.accessors[target]["count"].as_u64().unwrap_or(0) as usize / 3;
            }
            if let Some(target) = index(&primitive["material"], materials) {
                primitive["material"] = json!(target);
            }
        }
        scene.meshes.push(copy);
        scene.mesh_triangles.push(triangles);
        map.push(scene.meshes.len() - 1);
    }
    let mut nodes = Vec::new();
    for node in array(gltf, "nodes") {
        let Some(mesh) = index(&node["mesh"], &map) else {
            continue;
        };
        let name = node["name"].as_str().unwrap_or("mesh").to_string();
        nodes.push((name, node["matrix"].clone(), mesh));
    }
    Parts { nodes }
}
