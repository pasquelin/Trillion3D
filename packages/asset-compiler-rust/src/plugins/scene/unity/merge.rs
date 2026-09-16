//! Verser un modèle déjà converti dans la scène en construction.
//!
//! Un modèle référencé par la scène Unity est lu par le pilote de son format — jamais par celui-ci —
//! et rend un glTF complet. Le verser ici, c'est recopier ses tables en décalant chaque rang, une
//! seule fois par modèle : les instances suivantes réutilisent les mêmes maillages. Aucun sommet
//! n'est retouché, aucune image n'est réencodée ; seules les URI des images changent, pour rester
//! relatives au dossier servi.
use super::*;

/// Recopie les tables du modèle dans la scène. `prefix` est le chemin du dossier du modèle,
/// relativement au dossier servi : les images du modèle y sont nommées.
pub(super) fn merge(gltf: &Value, buffers: &[Vec<u8>], prefix: &str, scene: &mut Scene) -> Parts {
    let views = merge_views(gltf, buffers, scene);
    let accessors = merge_table(
        gltf,
        "accessors",
        &mut scene.accessors,
        &[Rule::key("bufferView", &views)],
        |_| {},
    );
    let images = merge_images(gltf, prefix, &views, scene);
    let samplers = merge_table(gltf, "samplers", &mut scene.samplers, &[], |_| {});
    scene.share_samplers(&samplers);
    let textures = merge_table(
        gltf,
        "textures",
        &mut scene.textures,
        &[
            Rule::key("source", &images),
            Rule::key("sampler", &samplers),
        ],
        |_| {},
    );
    let materials = merge_table(
        gltf,
        "materials",
        &mut scene.materials,
        &[Rule::suffix("Texture", &textures)],
        |_| {},
    );
    merge_meshes(gltf, &accessors, &materials, scene)
}

pub(super) fn array<'a>(gltf: &'a Value, name: &str) -> &'a [Value] {
    gltf[name].as_array().map_or(&[][..], Vec::as_slice)
}
pub(super) fn index(value: &Value, map: &[usize]) -> Option<usize> {
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

/// Recopie une table du modèle à la suite de celle de la scène, chaque entrée retouchée par `patch`
/// puis décalée par `rules`, et rend le rang de chaque entrée dans la scène.
fn merge_table(
    gltf: &Value,
    name: &str,
    dest: &mut Vec<Value>,
    rules: &[Rule<'_>],
    patch: impl Fn(&mut Value),
) -> Vec<usize> {
    array(gltf, name)
        .iter()
        .map(|entry| {
            let mut copy = entry.clone();
            patch(&mut copy);
            retarget(&mut copy, rules);
            dest.push(copy);
            dest.len() - 1
        })
        .collect()
}

/// Les images du modèle, leurs URI ramenées au dossier servi. Le préfixe est le chemin du dossier
/// du modèle : c'est là que ses images sont nommées, pas à la racine de la scène.
fn merge_images(gltf: &Value, prefix: &str, views: &[usize], scene: &mut Scene) -> Vec<usize> {
    merge_table(
        gltf,
        "images",
        &mut scene.images,
        &[Rule::key("bufferView", views)],
        |copy| {
            if let Some(uri) = copy["uri"].as_str() {
                if !prefix.is_empty() {
                    copy["uri"] = json!(format!("{prefix}/{uri}"));
                }
            }
        },
    )
}

/// Les maillages du modèle, et le nombre de triangles de chacun. Les rangs d'accesseur d'une
/// primitive sont ses attributs, ses indices et ceux de chaque cible de morphing ; son matériau
/// vient de l'autre table.
fn merge_meshes(
    gltf: &Value,
    accessors: &[usize],
    materials: &[usize],
    scene: &mut Scene,
) -> Parts {
    let rules = [
        Rule::members("attributes", accessors),
        Rule::members("targets", accessors),
        Rule::key("indices", accessors),
        Rule::key("material", materials),
    ];
    let map = merge_table(gltf, "meshes", &mut scene.meshes, &rules, |_| {});
    for mesh in &map {
        let mut triangles = 0usize;
        for primitive in array(&scene.meshes[*mesh], "primitives") {
            if let Some(indices) = primitive["indices"].as_u64() {
                triangles += scene.accessors[indices as usize]["count"]
                    .as_u64()
                    .unwrap_or(0) as usize
                    / 3;
            }
        }
        scene.mesh_triangles.push(triangles);
    }
    Parts {
        nodes: mesh_nodes(gltf, &map, &model_matrices(gltf, scene)),
    }
}
