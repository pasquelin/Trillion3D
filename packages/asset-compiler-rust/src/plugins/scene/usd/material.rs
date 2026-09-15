//! Un `Material` USD vers un matériau glTF, par son `UsdPreviewSurface`.
//!
//! `UsdPreviewSurface` et `pbrMetallicRoughness` décrivent la même chose sous deux noms : chaque
//! entrée est ou bien une valeur, ou bien une connexion vers un `UsdUVTexture`, et une entrée
//! connectée l'emporte sur le facteur, comme dans le reste du compilateur.
//!
//! La transparence suit la sémantique de USD et non un type d'objet : `opacityThreshold` écrit et
//! non nul fait une découpe (`MASK`) à ce seuil, une opacité inférieure à un ou portée par une
//! texture fait un mélange (`BLEND`), et rien de tout cela laisse la surface opaque.
//!
//! `doubleSided` est une propriété de la géométrie en USD et du matériau en glTF : c'est le
//! maillage qui l'apporte, et deux maillages qui la déclarent autrement sur le même `Material`
//! obtiennent deux matériaux glTF — un seul en aurait forcément trahi un.
use super::*;

/// L'identifiant du nœud de surface que ce pilote lit.
const PREVIEW_SURFACE: &str = "UsdPreviewSurface";

/// Le matériau glTF que ce chemin de prim désigne, versé dans les tables à sa première demande.
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

/// Construit le matériau : le `Shader` atteint depuis `outputs:surface`, puis ses entrées.
fn build(world: &mut World<'_>, path: &sdf::Path, double_sided: bool) -> Option<usize> {
    let material = world.stage.prim(path.clone()).ok()?;
    let Some(shader) = surface_shader(world, &material) else {
        world.refuse(world::SURFACE_UNSUPPORTED);
        return None;
    };
    let mut pbr = json!({});
    base_colour(world, &shader, &mut pbr);
    metallic_roughness(world, &shader, &mut pbr);
    let mut out = json!({
        "name": path.name().unwrap_or("Material"),
        "pbrMetallicRoughness": pbr,
        "alphaMode": alpha_mode(world, &shader),
    });
    if let Some(threshold) = cutoff(&shader) {
        out["alphaCutoff"] = json!(threshold);
    }
    for (usd_name, gltf_name) in [
        ("emissiveColor", "emissiveTexture"),
        ("normal", "normalTexture"),
    ] {
        if let Some(texture) = connected_texture(world, &shader, usd_name) {
            out[gltf_name] = texture;
        }
    }
    emissive_factor(&shader, &mut out);
    if double_sided {
        out["doubleSided"] = json!(true);
    }
    world.scene.materials.push(out);
    Some(world.scene.materials.len() - 1)
}

/// Le `Shader` de type `UsdPreviewSurface` que `outputs:surface` du matériau atteint.
fn surface_shader(world: &World<'_>, material: &usd::Prim) -> Option<usd::Prim> {
    let target = connection(material, "outputs:surface")?;
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::first(&shader.attribute("info:id")).and_then(|(value, _)| read::text(&value));
    (id.as_deref() == Some(PREVIEW_SURFACE)).then_some(shader)
}

/// La couleur de base et son alpha : la texture connectée l'emporte sur la couleur écrite, et
/// l'opacité entre dans le quatrième canal du facteur, comme glTF l'attend.
fn base_colour(world: &mut World<'_>, shader: &usd::Prim, pbr: &mut Value) {
    let opacity = scalar(shader, "opacity").unwrap_or(1.0);
    let colour = match connected_texture(world, shader, "diffuseColor") {
        Some(texture) => {
            pbr["baseColorTexture"] = texture;
            [1.0, 1.0, 1.0]
        }
        None => value(shader, "diffuseColor")
            .as_ref()
            .and_then(read::triple)
            .unwrap_or([1.0, 1.0, 1.0]),
    };
    pbr["baseColorFactor"] = json!([colour[0], colour[1], colour[2], opacity]);
}

/// Le métal et la rugosité. glTF n'a qu'une carte pour les deux ; deux textures distinctes ne s'y
/// ramènent pas sans recomposer une image, ce qui serait inventer des octets : les facteurs sont
/// alors seuls portés et l'écart est compté par son nom.
fn metallic_roughness(world: &mut World<'_>, shader: &usd::Prim, pbr: &mut Value) {
    pbr["metallicFactor"] = json!(scalar(shader, "metallic").unwrap_or(0.0));
    pbr["roughnessFactor"] = json!(scalar(shader, "roughness").unwrap_or(0.5));
    let metal = connection(shader, "inputs:metallic").map(|path| path.prim_path());
    let rough = connection(shader, "inputs:roughness").map(|path| path.prim_path());
    match (&metal, &rough) {
        (None, None) => {}
        (Some(one), Some(other)) if one == other => {
            if let Some(texture) = texture::resolve(world, one) {
                pbr["metallicRoughnessTexture"] = texture;
            }
        }
        _ => world.refuse(world::TEXTURE_UNSUPPORTED),
    }
}

/// La couleur d'émission écrite, quand elle n'est pas nulle.
fn emissive_factor(shader: &usd::Prim, out: &mut Value) {
    let colour = match out.get("emissiveTexture") {
        Some(_) => Some([1.0, 1.0, 1.0]),
        None => value(shader, "emissiveColor")
            .as_ref()
            .and_then(read::triple)
            .filter(|colour| colour.iter().any(|channel| *channel > 0.0)),
    };
    if let Some(colour) = colour {
        out["emissiveFactor"] = json!(colour);
    }
}

/// Le mode de transparence de ce matériau.
fn alpha_mode(world: &mut World<'_>, shader: &usd::Prim) -> &'static str {
    if cutoff(shader).is_some() {
        return "MASK";
    }
    let textured = connected_texture(world, shader, "opacity").is_some();
    match textured || scalar(shader, "opacity").unwrap_or(1.0) < 1.0 {
        true => "BLEND",
        false => "OPAQUE",
    }
}

/// Le seuil de découpe, quand la surface en déclare un qui découpe vraiment.
fn cutoff(shader: &usd::Prim) -> Option<f64> {
    scalar(shader, "opacityThreshold").filter(|threshold| *threshold > 0.0)
}

/// La texture branchée sur une entrée du nœud de surface.
fn connected_texture(world: &mut World<'_>, shader: &usd::Prim, name: &str) -> Option<Value> {
    let target = connection(shader, &format!("inputs:{name}"))?;
    texture::resolve(world, &target)
}

/// La première connexion d'un attribut.
fn connection(prim: &usd::Prim, name: &str) -> Option<sdf::Path> {
    prim.attribute(name).connections().ok()?.into_iter().next()
}

/// La valeur écrite d'une entrée du nœud de surface.
fn value(shader: &usd::Prim, name: &str) -> Option<sdf::Value> {
    read::first(&shader.attribute(format!("inputs:{name}"))).map(|(value, _)| value)
}

/// Une entrée scalaire du nœud de surface.
fn scalar(shader: &usd::Prim, name: &str) -> Option<f64> {
    value(shader, name).as_ref().and_then(read::number)
}
