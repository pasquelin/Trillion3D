//! Un matériau Blender vers un matériau PBR glTF.
//!
//! Blender décrit ses matériaux par un graphe de nœuds, et c'est **la sortie active** qui dit lequel
//! de ces nœuds rend la surface : un nuanceur posé à côté du graphe, que rien ne relie à cette
//! sortie, ne décrit pas le matériau. Le pilote part donc du nœud `Material Output` que le fichier
//! marque, suit son entrée `Surface`, et ne lit qu'un nuanceur, le plus répandu : `Principled
//! BSDF`, dont les entrées portent déjà les grandeurs du glTF — couleur de base, métallicité,
//! rugosité, alpha, émission, normale. Un autre nuanceur au bout de `Surface` — émission, verre,
//! mélange — n'a pas d'équivalent ici : il est compté par son nom, et les grandeurs que le bloc de
//! matériau porte lui-même restent, exactes.
//!
//! Les entrées sont demandées par leur identifiant, jamais par leur rang : une version de Blender
//! qui en ajoute ou en déplace ne change rien ici. Une entrée branchée sur une image donne la
//! texture correspondante ; branchée sur autre chose, elle est comptée au rapport et la valeur
//! déclarée est conservée, exacte.
//!
//! Un matériau sans graphe garde les grandeurs que le bloc `MA` porte lui-même. Aucune conversion
//! de grandeur n'est faite : couleur, métallicité, rugosité et alpha vivent dans [0, 1] des deux
//! côtés. La seule borne est l'émission, que Blender écrit en intensité libre et que le glTF veut
//! dans [0, 1] ; le dépassement est compté, jamais silencieux.
use super::*;

const PRINCIPLED: &str = "ShaderNodeBsdfPrincipled";
/// Le nœud par lequel un graphe de matériau sort vers le rendu.
const OUTPUT: &str = "ShaderNodeOutputMaterial";
/// Le bit par lequel Blender marque, parmi les sorties d'un graphe, celle qui rend.
const DO_OUTPUT: i64 = 1 << 6;
/// Ce que la sortie active atteint quand ce n'est pas un `Principled BSDF`, ou qu'elle n'atteint
/// rien : la surface n'est pas convertie, et le bloc de matériau reprend la main.
const SURFACE_UNSUPPORTED: &str = "blend-surface-node-unsupported";

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
    let Some(graph) = material.follow("nodetree") else {
        return gltf;
    };
    let tree = shading::Tree::read(&graph);
    let Some(node) = surface(&graph, &tree, out) else {
        return gltf;
    };
    principled_json(material, &node, &tree, root, images, out, &mut gltf);
    gltf
}

/// Le nuanceur qui rend la surface : celui que l'entrée `Surface` de la sortie active atteint.
fn surface<'a>(graph: &At<'a>, tree: &shading::Tree<'a>, out: &mut Out) -> Option<At<'a>> {
    let found = output(graph)
        .and_then(|node| shading::socket(&node, "Surface"))
        .and_then(|socket| tree.source(&socket))
        .filter(|node| node.text("idname") == PRINCIPLED);
    if found.is_none() {
        out.report.add(SURFACE_UNSUPPORTED);
    }
    found
}

/// La sortie du graphe que le fichier marque active ; à défaut de marque, la première écrite.
fn output<'a>(graph: &At<'a>) -> Option<At<'a>> {
    let mut first = None;
    for node in graph
        .list("nodes")
        .into_iter()
        .filter(|node| node.text("idname") == OUTPUT)
    {
        if node.int("flag", 0) & DO_OUTPUT != 0 {
            return Some(node);
        }
        first.get_or_insert(node);
    }
    first
}

/// Remplit le matériau glTF depuis les entrées du nœud.
fn principled_json(
    material: &At<'_>,
    node: &At<'_>,
    tree: &shading::Tree<'_>,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
    gltf: &mut Value,
) {
    let base = shading::socket(node, "Base Color");
    let declared = base
        .as_ref()
        .map_or_else(Vec::new, |s| shading::value(s, 0.8));
    let metallic = shading::factor(node, tree, "Metallic", 0.0, out);
    let roughness = shading::factor(node, tree, "Roughness", 0.5, out);
    let linked = base
        .as_ref()
        .and_then(|s| shading::texture(s, tree, root, images, out));
    let alpha = alpha::of(node, tree, base.as_ref(), linked.is_some(), out);
    let mut color = [0.8, 0.8, 0.8, alpha.factor.clamp(0.0, 1.0)];
    for (axis, slot) in color.iter_mut().take(3).enumerate() {
        *slot = declared.get(axis).copied().unwrap_or(0.8);
    }
    let pbr = &mut gltf["pbrMetallicRoughness"];
    pbr["metallicFactor"] = json!(metallic);
    pbr["roughnessFactor"] = json!(roughness);
    if let Some(index) = linked {
        pbr["baseColorTexture"] = json!({"index": index});
        color[..3].fill(1.0);
    }
    pbr["baseColorFactor"] = json!(color);
    alpha::mode(material, &alpha, gltf);
    shading::emission(node, tree, root, images, out, gltf);
    if let Some(index) = shading::normal_texture(node, tree, root, images, out) {
        gltf["normalTexture"] = json!({"index": index});
    }
}
