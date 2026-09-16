//! Un nuanceur de surface de Maya vers un matériau glTF `pbrMetallicRoughness`.
//!
//! **Un attribut absent n'est pas remplacé par la valeur par défaut de l'interface de Maya, mais
//! par la valeur neutre de glTF** : le fichier ne l'écrit pas, et ce pilote ne l'invente pas. Ce qui
//! est écrit, en revanche, est lu selon le modèle du nuanceur : `lambert` est une surface
//! entièrement diffuse, donc de rugosité un ; la puissance de cosinus d'un `phong` donne la
//! rugosité par `√(2 / (n + 2))`, la relation usuelle entre le lobe de Blinn-Phong et celui de
//! `pbrMetallicRoughness` ; l'excentricité d'un `blinn` est déjà une largeur de lobe et se lit
//! comme une rugosité. Aucun de ces trois nuanceurs ne décrit un métal : leur métallicité est nulle.
//! `standardSurface` porte les deux grandeurs directement.
//!
//! La transparence suit la sémantique du nuanceur et non un type d'objet : une opacité inférieure à
//! un, ou portée par une image, fait un mélange (`BLEND`) ; rien de tout cela laisse la surface
//! opaque. Aucun nuanceur de Maya ne déclare de seuil de découpe, donc jamais `MASK` — découper un
//! transparent serait une perte de fidélité.
use super::*;

/// Le matériau glTF de ce nuanceur, versé dans les tables à sa première demande.
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

/// Construit le matériau. Un nuanceur hors des quatre lus est compté, et la surface reste sans
/// matériau plutôt que d'en recevoir un inventé.
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

/// La couleur de base, et la texture qui la porte quand une image y est branchée. glTF multiplie sa
/// texture par son facteur : le facteur passe donc au blanc, comme partout ailleurs dans ce dépôt.
fn base(world: &mut World<'_>, shader: usize, standard: bool, pbr: &mut Value) -> [f64; 3] {
    let document = world.document;
    let names: &[&str] = match standard {
        true => &["bc", "baseColor"],
        false => &["c", "color"],
    };
    if let Some(texture) = texture::connected(world, shader, names) {
        pbr["baseColorTexture"] = texture;
        return [1.0, 1.0, 1.0];
    }
    let node = &document.nodes[shader];
    let weight = match standard {
        true => number(node, &["b", "base"], 1.0),
        false => number(node, &["dc", "diffuse"], 1.0),
    };
    let colour = node
        .attr(names)
        .and_then(Attr::triple)
        .unwrap_or([1.0, 1.0, 1.0]);
    colour.map(|channel| (channel * weight).clamp(0.0, 1.0))
}

/// L'émission de la surface : l'incandescence d'un `lambert`, `phong` ou `blinn`, la couleur
/// d'émission d'un `standardSurface` multipliée par son poids.
fn emission(world: &mut World<'_>, shader: usize, standard: bool, out: &mut Value) {
    let document = world.document;
    let names: &[&str] = match standard {
        true => &["ec", "emissionColor"],
        false => &["ic", "incandescence"],
    };
    if let Some(texture) = texture::connected(world, shader, names) {
        out["emissiveTexture"] = texture;
        out["emissiveFactor"] = json!([1.0, 1.0, 1.0]);
        return;
    }
    let node = &document.nodes[shader];
    let weight = match standard {
        true => number(node, &["e", "emission"], 0.0),
        false => 1.0,
    };
    let Some(colour) = node.attr(names).and_then(Attr::triple) else {
        return;
    };
    let lit = colour.map(|channel| channel * weight);
    if lit.iter().any(|channel| *channel > 1.0) {
        world.refuse(report::EMISSION_CLAMPED);
    }
    if lit.iter().any(|channel| *channel > 0.0) {
        out["emissiveFactor"] = json!(lit.map(|channel| channel.clamp(0.0, 1.0)));
    }
}

/// L'alpha de la surface, et si ses trois canaux diffèrent. Maya décrit la transparence en couleur :
/// glTF n'a qu'un canal, et c'est la moyenne des trois qui est portée plutôt qu'un canal choisi au
/// hasard. L'écart est compté par son nom.
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

/// La rugosité que le modèle du nuanceur donne.
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

/// Le nombre de l'un de ces attributs, ou la valeur neutre quand le fichier ne l'écrit pas.
fn number(node: &Node, names: &[&str], neutral: f64) -> f64 {
    node.attr(names).and_then(Attr::scalar).unwrap_or(neutral)
}

/// Une image branchée sur l'opacité ou la transparence. glTF ne porte l'opacité que dans l'alpha de
/// la couleur de base : une seconde image ne s'y branche pas, elle est comptée.
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
