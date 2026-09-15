//! Un matériau Blender vers un matériau PBR glTF.
//!
//! Blender décrit ses matériaux par un graphe de nœuds. Ce pilote en lit **un seul**, le plus
//! répandu : `Principled BSDF`, dont les entrées portent déjà les grandeurs du glTF — couleur de
//! base, métallicité, rugosité, alpha, émission, normale. Les entrées sont demandées par leur
//! identifiant, jamais par leur rang : une version de Blender qui en ajoute ou en déplace ne change
//! rien ici. Une entrée branchée sur une image donne la texture correspondante ; branchée sur autre
//! chose, elle est comptée au rapport et la valeur déclarée est conservée, exacte.
//!
//! Un matériau sans graphe garde les grandeurs que le bloc `MA` porte lui-même. Aucune conversion
//! de grandeur n'est faite : couleur, métallicité, rugosité et alpha vivent dans [0, 1] des deux
//! côtés. La seule borne est l'émission, que Blender écrit en intensité libre et que le glTF veut
//! dans [0, 1] ; le dépassement est compté, jamais silencieux.
use super::*;

const PRINCIPLED: &str = "ShaderNodeBsdfPrincipled";

/// Convertit un bloc `MA` en matériau glTF.
pub(super) fn material_json(
    material: &At<'_>,
    name: &str,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
) -> Value {
    let mut gltf = json!({"name": name, "pbrMetallicRoughness": {
        "baseColorFactor": [
            material.float("r", 0.8), material.float("g", 0.8),
            material.float("b", 0.8), material.float("a", 1.0),
        ],
        "metallicFactor": material.float("metallic", 0.0),
        "roughnessFactor": material.float("roughness", 0.5),
    }});
    let Some(node) = principled(material) else {
        return gltf;
    };
    let tree = shading::Tree::read(material);
    principled_json(&node, &tree, root, images, out, &mut gltf);
    gltf
}

/// Le nœud `Principled BSDF` du graphe d'un matériau, quand il en a un.
fn principled<'a>(material: &At<'a>) -> Option<At<'a>> {
    let tree = material.follow("nodetree")?;
    tree.list("nodes")
        .into_iter()
        .find(|node| node.text("idname") == PRINCIPLED)
}

/// Remplit le matériau glTF depuis les entrées du nœud.
fn principled_json(
    node: &At<'_>,
    tree: &shading::Tree<'_>,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
    gltf: &mut Value,
) {
    let alpha = shading::socket(node, "Alpha");
    let opacity = alpha.as_ref().map_or(1.0, |s| shading::value(s, 1.0)[0]);
    let base = shading::socket(node, "Base Color");
    let declared = base
        .as_ref()
        .map_or_else(Vec::new, |s| shading::value(s, 0.8));
    let mut color = [0.8, 0.8, 0.8, opacity.clamp(0.0, 1.0)];
    for (axis, slot) in color.iter_mut().take(3).enumerate() {
        *slot = declared.get(axis).copied().unwrap_or(0.8);
    }
    let metallic = shading::factor(node, tree, "Metallic", 0.0, out);
    let roughness = shading::factor(node, tree, "Roughness", 0.5, out);
    let linked = base
        .as_ref()
        .and_then(|s| shading::texture(s, tree, root, images, out));
    let pbr = &mut gltf["pbrMetallicRoughness"];
    pbr["metallicFactor"] = json!(metallic);
    pbr["roughnessFactor"] = json!(roughness);
    if let Some(index) = linked {
        pbr["baseColorTexture"] = json!({"index": index});
        color[..3].fill(1.0);
    }
    pbr["baseColorFactor"] = json!(color);
    if opacity < 1.0 || alpha.as_ref().is_some_and(|s| tree.source(s).is_some()) {
        gltf["alphaMode"] = json!("BLEND");
    }
    shading::emission(node, tree, root, images, out, gltf);
    if let Some(index) = shading::normal_texture(node, tree, root, images, out) {
        gltf["normalTexture"] = json!({"index": index});
    }
}
