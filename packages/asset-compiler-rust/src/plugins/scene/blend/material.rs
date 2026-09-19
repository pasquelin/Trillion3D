//! A Blender material to a glTF PBR material.
//!
//! Blender describes its materials by a node graph, and it is **the active output** that says
//! which of these nodes renders the surface: a shader sitting beside the graph, which nothing
//! connects to that output, does not describe the material. The driver therefore starts from the
//! `Material Output` node the file marks, follows its `Surface` input, and only reads one shader,
//! the most common: `Principled BSDF`, whose inputs already carry the glTF quantities — base
//! colour, metallic, roughness, alpha, emission, normal. Another shader at the end of `Surface`
//! — emission, glass, mix — has no equivalent here: it is counted by its name, and the
//! quantities the material block itself carries stay, exact.
//!
//! Inputs are asked for by their identifier, never by their rank: a Blender version that adds or
//! moves some changes nothing here. An input linked to an image gives the corresponding texture;
//! linked to something else, it is counted on the report and the declared value is kept, exact.
//!
//! A material without a graph keeps the quantities the `MA` block itself carries. No quantity
//! conversion is done: colour, metallic, roughness and alpha live in [0, 1] on both sides. The
//! only bound is emission, which Blender writes as a free intensity and which glTF wants in
//! [0, 1]; the overflow is counted, never silent.
use super::*;

const PRINCIPLED: &str = "ShaderNodeBsdfPrincipled";
/// The node through which a material graph exits toward rendering.
const OUTPUT: &str = "ShaderNodeOutputMaterial";
/// The bit by which Blender marks, among a graph's outputs, the one that renders.
const DO_OUTPUT: i64 = 1 << 6;
/// What the active output reaches when it is not a `Principled BSDF`, or when it reaches
/// nothing: the surface is not converted, and the material block takes over.
const SURFACE_UNSUPPORTED: &str = "blend-surface-node-unsupported";

/// Converts an `MA` block to a glTF material.
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

/// The shader that renders the surface: the one the active output's `Surface` input reaches.
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

/// The graph output the file marks active; failing a mark, the first written.
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

/// Fills the glTF material from the node's inputs.
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
