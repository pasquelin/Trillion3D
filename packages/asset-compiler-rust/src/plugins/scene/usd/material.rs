//! Un `Material` USD vers un matériau glTF, par son `UsdPreviewSurface`.
//!
//! `UsdPreviewSurface` et `pbrMetallicRoughness` décrivent la même chose sous deux noms : chaque
//! entrée est ou bien une valeur, ou bien une connexion vers un `UsdUVTexture`, et une entrée
//! connectée l'emporte sur le facteur, comme dans le reste du compilateur.
//!
//! La transparence suit la sémantique de USD et non un type d'objet ; elle est lue dans
//! `opacity.rs`, qui dit aussi ce que glTF ne sait pas porter.
//!
//! `doubleSided` est une propriété de la géométrie en USD et du matériau en glTF : c'est le
//! maillage qui l'apporte, et deux maillages qui la déclarent autrement sur le même `Material`
//! obtiennent deux matériaux glTF — un seul en aurait forcément trahi un.
use super::*;

/// L'identifiant du nœud de surface que ce pilote lit.
const PREVIEW_SURFACE: &str = "UsdPreviewSurface";
/// Le nom du matériau que les surfaces double face sans liaison partagent. Une clé de matériau
/// résolu porte toujours un chemin de prim et un `#` : aucune ne se confond avec celle-ci.
const DOUBLE_SIDED: &str = "usd-double-sided";
/// La couleur diffuse implicite d'un `UsdPreviewSurface`, telle que la spécification la pose : un
/// gris, jamais le blanc — une surface lue blanche renvoie cinq fois trop de lumière.
const DEFAULT_DIFFUSE: [f64; 3] = [0.18, 0.18, 0.18];
/// Le canal où glTF lit le métal de sa carte partagée, et celui où il lit la rugosité.
const METAL_CHANNEL: &str = "outputs:b";
const ROUGH_CHANNEL: &str = "outputs:g";

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

/// Le matériau qu'une surface double face reçoit quand aucun `Material` ne la lie. `doubleSided`
/// est une propriété de la géométrie en USD et du matériau en glTF : sans matériau pour la porter,
/// les deux faces se perdraient. Un seul matériau sert à toutes les surfaces dans ce cas.
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

/// Le `Shader` de type `UsdPreviewSurface` que `outputs:surface` du matériau atteint.
fn surface_shader(world: &World<'_>, material: &usd::Prim) -> Option<usd::Prim> {
    let target = connection(material, "outputs:surface")?;
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::first(&shader.attribute("info:id")).and_then(|(value, _)| read::text(&value));
    (id.as_deref() == Some(PREVIEW_SURFACE)).then_some(shader)
}

/// La couleur de base et son alpha : la texture connectée l'emporte sur la couleur écrite, et
/// l'opacité entre dans le quatrième canal du facteur, comme glTF l'attend.
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

/// Le métal et la rugosité. glTF n'a qu'une carte pour les deux ; deux textures distinctes ne s'y
/// ramènent pas sans recomposer une image, ce qui serait inventer des octets : les facteurs sont
/// alors seuls portés et l'écart est compté par son nom.
///
/// Une carte partagée, elle, l'emporte sur les facteurs écrits, que glTF multiplie par elle : ils
/// valent un, sans quoi la carte serait annulée. Reste à savoir d'où chaque entrée tire son canal :
/// glTF prend le métal dans le bleu et la rugosité dans le vert, et un autre canal ne s'y range pas.
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

/// La texture branchée sur une entrée du nœud de surface, et le rôle de cette entrée.
pub(super) fn connected_texture(
    world: &mut World<'_>,
    shader: &usd::Prim,
    name: &str,
    colour: bool,
) -> Option<texture::Bound> {
    let target = connection(shader, &format!("inputs:{name}"))?;
    texture::resolve(world, &target, colour)
}

/// La première connexion d'un attribut.
pub(super) fn connection(prim: &usd::Prim, name: &str) -> Option<sdf::Path> {
    prim.attribute(name).connections().ok()?.into_iter().next()
}

/// La valeur écrite d'une entrée du nœud de surface.
pub(super) fn value(shader: &usd::Prim, name: &str) -> Option<sdf::Value> {
    read::first(&shader.attribute(format!("inputs:{name}"))).map(|(value, _)| value)
}

/// Une entrée scalaire du nœud de surface.
pub(super) fn scalar(shader: &usd::Prim, name: &str) -> Option<f64> {
    value(shader, name).as_ref().and_then(read::number)
}
