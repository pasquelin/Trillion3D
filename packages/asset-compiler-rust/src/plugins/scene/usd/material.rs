//! A USD `Material` into a glTF material, through its `UsdPreviewSurface`.
//!
//! `UsdPreviewSurface` and `pbrMetallicRoughness` describe the same thing under two names: each
//! input is either a value, or a connection toward a `UsdUVTexture`, and a connected input wins
//! over the factor, as in the rest of the compiler.
//!
//! Transparency follows USD semantics and not an object type; it is read in `opacity.rs`, which
//! also says what glTF cannot carry.
//!
//! `doubleSided` is a property of the geometry in USD and of the material in glTF: it is the
//! mesh that brings it, and two meshes that declare it differently on the same `Material` get
//! two glTF materials — a single one would necessarily have betrayed one.
use super::*;

/// Identifier of the surface node this driver reads.
const PREVIEW_SURFACE: &str = "UsdPreviewSurface";
/// Name of the material that double-sided surfaces without a binding share. A resolved material
/// key always carries a prim path and a `#`: none is mixed up with this one.
const DOUBLE_SIDED: &str = "usd-double-sided";
/// Implicit diffuse colour of a `UsdPreviewSurface`, as the specification sets it: a grey,
/// never white — a surface read as white returns five times too much light.
const DEFAULT_DIFFUSE: [f64; 3] = [0.18, 0.18, 0.18];
/// Channel where glTF reads metal from its shared map, and the one where it reads roughness.
const METAL_CHANNEL: &str = "outputs:b";
const ROUGH_CHANNEL: &str = "outputs:g";

/// glTF material this prim path names, poured into the tables on first request.
pub(super) fn resolve(
    world: &mut World<'_>,
    path: &sdf::Path,
    double_sided: bool,
) -> Option<usize> {
    let key = format!("{}#{double_sided}", path.as_str());
    if let Some(known) = world.materials.get(&key) {
        return *known;
    }
    let built = build(world, path, double_sided);
    world.materials.insert(key, built);
    if built.is_some() {
        world.count("materials", 1);
    }
    built
}

/// Builds the material: the `Shader` reached from the material's `outputs:surface`, then its
/// inputs.
fn build(world: &mut World<'_>, path: &sdf::Path, double_sided: bool) -> Option<usize> {
    let material = world.stage.prim(path.clone()).ok()?;
    let Some(shader) = surface_shader(world, &material) else {
        world.refuse(world::SURFACE_UNSUPPORTED);
        return None;
    };
    let mut pbr = json!({});
    let transparency = base_colour(world, &shader, &mut pbr);
    metallic_roughness(world, &shader, &mut pbr);
    let mut out = json!({
        "name": path.name().unwrap_or("Material"),
        "pbrMetallicRoughness": pbr,
        "alphaMode": opacity::mode(&shader, transparency),
    });
    if let Some(threshold) = opacity::cutoff(&shader) {
        out["alphaCutoff"] = json!(threshold);
    }
    extras::emissive(world, &shader, &mut out);
    extras::occlusion(world, &shader, &mut out);
    extras::counted(world, &shader);
    if let Some(bound) = connected_texture(world, &shader, "normal", false) {
        out["normalTexture"] = bound.plain(world);
    }
    if double_sided {
        out["doubleSided"] = json!(true);
    }
    world.scene.materials.push(out);
    Some(world.scene.materials.len() - 1)
}

/// Material a double-sided surface receives when no `Material` binds it. `doubleSided` is a
/// property of the geometry in USD and of the material in glTF: without a material to carry it,
/// both faces would be lost. A single material serves every surface in that case.
pub(super) fn double_sided(world: &mut World<'_>) -> Option<usize> {
    if let Some(known) = world.materials.get(DOUBLE_SIDED) {
        return *known;
    }
    world
        .scene
        .materials
        .push(json!({"name": DOUBLE_SIDED, "doubleSided": true}));
    let rank = world.scene.materials.len() - 1;
    world.materials.insert(DOUBLE_SIDED.to_string(), Some(rank));
    world.count("materials", 1);
    Some(rank)
}

/// `Shader` of type `UsdPreviewSurface` that the material's `outputs:surface` reaches.
fn surface_shader(world: &World<'_>, material: &usd::Prim) -> Option<usd::Prim> {
    let target = connection(material, "outputs:surface")?;
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::first(&shader.attribute("info:id")).and_then(|(value, _)| read::text(&value));
    (id.as_deref() == Some(PREVIEW_SURFACE)).then_some(shader)
}

/// Base colour and its alpha: the connected texture wins over the written colour, and opacity
/// enters the fourth channel of the factor, as glTF expects.
fn base_colour(world: &mut World<'_>, shader: &usd::Prim, pbr: &mut Value) -> opacity::Opacity {
    let diffuse = connection(shader, "inputs:diffuseColor");
    let textured = diffuse
        .as_ref()
        .and_then(|target| texture::resolve(world, target, true));
    let colour = match textured {
        Some(bound) => {
            let factor = bound.factor(world);
            pbr["baseColorTexture"] = bound.value;
            [factor; 3]
        }
        None => value(shader, "diffuseColor")
            .as_ref()
            .and_then(read::triple)
            .unwrap_or(DEFAULT_DIFFUSE),
    };
    let transparency = opacity::of(world, shader, pbr, diffuse.as_ref());
    pbr["baseColorFactor"] = json!([colour[0], colour[1], colour[2], transparency.factor]);
    transparency
}

/// Metal and roughness. glTF has only one map for both; two distinct textures do not fold into
/// it without recomposing an image, which would invent bytes: the factors are then carried
/// alone and the mismatch is counted by name.
///
/// A shared map, for its part, wins over the written factors, which glTF multiplies by it: they
/// are one, otherwise the map would be cancelled. What remains is where each input draws its
/// channel from: glTF takes metal in blue and roughness in green, and another channel does not
/// fit there.
fn metallic_roughness(world: &mut World<'_>, shader: &usd::Prim, pbr: &mut Value) {
    let metal = connection(shader, "inputs:metallic");
    let rough = connection(shader, "inputs:roughness");
    let shared = match (&metal, &rough) {
        (Some(one), Some(other)) if one.prim_path() == other.prim_path() => {
            texture::resolve(world, one, false)
        }
        (None, None) => None,
        _ => {
            world.refuse(world::TEXTURE_UNSUPPORTED);
            None
        }
    };
    let Some(map) = shared else {
        pbr["metallicFactor"] = json!(scalar(shader, "metallic").unwrap_or(0.0));
        pbr["roughnessFactor"] = json!(scalar(shader, "roughness").unwrap_or(0.5));
        return;
    };
    let factor = map.factor(world);
    pbr["metallicRoughnessTexture"] = map.value;
    pbr["metallicFactor"] = json!(factor);
    pbr["roughnessFactor"] = json!(factor);
    for (input, channel) in [(metal, METAL_CHANNEL), (rough, ROUGH_CHANNEL)] {
        let placed = input.is_some_and(|path| {
            path.split_property()
                .is_some_and(|(_, name)| name == channel)
        });
        if !placed {
            world.refuse(world::TEXTURE_CHANNEL);
        }
    }
}

/// Texture wired onto an input of the surface node, and the role of that input.
pub(super) fn connected_texture(
    world: &mut World<'_>,
    shader: &usd::Prim,
    name: &str,
    colour: bool,
) -> Option<texture::Bound> {
    let target = connection(shader, &format!("inputs:{name}"))?;
    texture::resolve(world, &target, colour)
}

/// First connection of an attribute.
pub(super) fn connection(prim: &usd::Prim, name: &str) -> Option<sdf::Path> {
    prim.attribute(name).connections().ok()?.into_iter().next()
}

/// Written value of an input of the surface node.
pub(super) fn value(shader: &usd::Prim, name: &str) -> Option<sdf::Value> {
    read::first(&shader.attribute(format!("inputs:{name}"))).map(|(value, _)| value)
}

/// A scalar input of the surface node.
pub(super) fn scalar(shader: &usd::Prim, name: &str) -> Option<f64> {
    value(shader, name).as_ref().and_then(read::number)
}
