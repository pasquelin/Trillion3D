//! A Maya surface shader into a glTF `pbrMetallicRoughness` material.
//!
//! **A missing attribute is not replaced by Maya's UI default, but by glTF's neutral value**: the
//! file does not write it, and this driver does not invent it. What is written, on the other
//! hand, is read according to the shader model: `lambert` is a fully diffuse surface, so
//! roughness one; a `phong` cosine power yields roughness by `√(2 / (n + 2))`, the usual
//! relation between the Blinn-Phong lobe and that of `pbrMetallicRoughness`; a `blinn`
//! eccentricity is already a lobe width and is read as roughness. None of these three shaders
//! describes a metal: their metallic is zero. `standardSurface` carries both quantities
//! directly.
//!
//! Transparency follows the shader's semantics, not an object type: an opacity below one, or
//! carried by an image, makes a blend (`BLEND`); none of that leaves the surface opaque. No
//! Maya shader declares a cutoff threshold, so never `MASK` — cutting a transparent would be a
//! fidelity loss.
use super::*;

/// glTF material of this shader, poured into the tables on first request.
pub(super) fn resolve(world: &mut World<'_>, shader: usize) -> Option<usize> {
    if let Some(known) = world.materials.get(&shader) {
        return *known;
    }
    let built = build(world, shader);
    world.materials.insert(shader, built);
    if built.is_some() {
        world.scene.count("materials", 1);
    }
    built
}

/// Builds the material. A shader outside the four that are read is counted, and the surface
/// stays without a material rather than receiving an invented one.
fn build(world: &mut World<'_>, shader: usize) -> Option<usize> {
    let (document, graph) = (world.document, world.graph);
    let node = &document.nodes[shader];
    if !report::is_shader(&node.kind) {
        world.refuse(report::MATERIAL_UNSUPPORTED);
        return None;
    }
    let standard = node.kind == "standardSurface";
    let (name, (alpha, uneven)) = (node.name.clone(), alpha(node, standard));
    if uneven {
        world.refuse(report::TRANSPARENCY_COLOUR);
    }
    let metallic = match standard {
        true => number(node, &["mt", "metalness"], 0.0).clamp(0.0, 1.0),
        false => 0.0,
    };
    let mut pbr = json!({"metallicFactor": metallic, "roughnessFactor": roughness(node)});
    let colour = base(world, shader, standard, &mut pbr);
    pbr["baseColorFactor"] = json!([colour[0], colour[1], colour[2], alpha]);
    let mut out = json!({"name": name, "pbrMetallicRoughness": pbr});
    emission(world, shader, standard, &mut out);
    if let Some(texture) = normal::through_bump(world, shader) {
        out["normalTexture"] = texture;
    }
    let veiled = opacity_texture(world, shader, standard);
    out["alphaMode"] = json!(if alpha < 1.0 || veiled {
        "BLEND"
    } else {
        "OPAQUE"
    });
    let packed = (standard && graph.input(shader, &["mt", "metalness"]).is_some())
        || graph.input(shader, &["sr", "specularRoughness"]).is_some();
    if packed {
        world.refuse(report::TEXTURE_UNSUPPORTED);
    }
    world.scene.materials.push(out);
    Some(world.scene.materials.len() - 1)
}

/// Base colour, and the texture that carries it when an image is wired onto it. glTF multiplies
/// its texture by its factor: the factor therefore carries only what the texture does not say,
/// that is the scalar weight — `base` or `diffuse` — that multiplies the shader colour. An
/// image replaces the colour, never its weight.
fn base(world: &mut World<'_>, shader: usize, standard: bool, pbr: &mut Value) -> [f64; 3] {
    let document = world.document;
    let names: &[&str] = match standard {
        true => &["bc", "baseColor"],
        false => &["c", "color"],
    };
    let node = &document.nodes[shader];
    let weight = match standard {
        true => number(node, &["b", "base"], 1.0),
        false => number(node, &["dc", "diffuse"], 1.0),
    };
    if let Some(texture) = texture::connected(world, shader, names) {
        pbr["baseColorTexture"] = texture;
        return [weight.clamp(0.0, 1.0); 3];
    }
    let colour = node
        .attr(names)
        .and_then(Attr::triple)
        .unwrap_or([1.0, 1.0, 1.0]);
    colour.map(|channel| (channel * weight).clamp(0.0, 1.0))
}

/// Surface emission: incandescence of a `lambert`, `phong` or `blinn`, the emission colour of a
/// `standardSurface` multiplied by its weight. The weight also holds when an image carries the
/// colour: it is that, not white, that `emissiveFactor` then carries.
fn emission(world: &mut World<'_>, shader: usize, standard: bool, out: &mut Value) {
    let document = world.document;
    let names: &[&str] = match standard {
        true => &["ec", "emissionColor"],
        false => &["ic", "incandescence"],
    };
    let node = &document.nodes[shader];
    let weight = match standard {
        true => number(node, &["e", "emission"], 0.0),
        false => 1.0,
    };
    let lit = match texture::connected(world, shader, names) {
        Some(texture) => {
            out["emissiveTexture"] = texture;
            [weight; 3]
        }
        None => match node.attr(names).and_then(Attr::triple) {
            Some(colour) => colour.map(|channel| channel * weight),
            None => return,
        },
    };
    if lit.iter().any(|channel| *channel > 1.0) {
        world.refuse(report::EMISSION_CLAMPED);
    }
    if lit.iter().any(|channel| *channel > 0.0) {
        out["emissiveFactor"] = json!(lit.map(|channel| channel.clamp(0.0, 1.0)));
    }
}

/// Surface alpha, and whether its three channels differ. Maya describes transparency as a
/// colour: glTF has only one channel, and it is the mean of the three that is carried rather
/// than a channel picked at random. The mismatch is counted by name.
fn alpha(node: &Node, standard: bool) -> (f64, bool) {
    let names: &[&str] = match standard {
        true => &["o", "opacity"],
        false => &["it", "transparency"],
    };
    let Some(colour) = node.attr(names).and_then(Attr::triple) else {
        return (1.0, false);
    };
    let mean = colour.iter().sum::<f64>() / 3.0;
    let uneven = colour.iter().any(|channel| *channel != colour[0]);
    let alpha = match standard {
        true => mean,
        false => 1.0 - mean,
    };
    (alpha.clamp(0.0, 1.0), uneven)
}

/// Roughness that the shader model yields.
fn roughness(node: &Node) -> f64 {
    match node.kind.as_str() {
        "lambert" => 1.0,
        "phong" => node
            .attr(&["cp", "cosinePower"])
            .and_then(Attr::scalar)
            .filter(|power| *power > -2.0)
            .map_or(0.5, |power| (2.0 / (power + 2.0)).sqrt().clamp(0.0, 1.0)),
        "blinn" => number(node, &["ec", "eccentricity"], 0.5).clamp(0.0, 1.0),
        _ => number(node, &["sr", "specularRoughness"], 0.5).clamp(0.0, 1.0),
    }
}

/// Number of one of these attributes, or the neutral value when the file does not write it.
fn number(node: &Node, names: &[&str], neutral: f64) -> f64 {
    node.attr(names).and_then(Attr::scalar).unwrap_or(neutral)
}

/// An image wired onto opacity or transparency. glTF carries opacity only in the alpha of the
/// base colour: a second image does not wire onto it, it is counted.
fn opacity_texture(world: &mut World<'_>, shader: usize, standard: bool) -> bool {
    let names: &[&str] = match standard {
        true => &["o", "opacity"],
        false => &["it", "transparency"],
    };
    let graph = world.graph;
    let Some((source, _)) = graph.input(shader, names) else {
        return false;
    };
    let base = match standard {
        true => graph.input(shader, &["bc", "baseColor"]),
        false => graph.input(shader, &["c", "color"]),
    };
    if base.map(|(node, _)| node) != Some(source) {
        world.refuse(report::TEXTURE_UNSUPPORTED);
    }
    true
}
