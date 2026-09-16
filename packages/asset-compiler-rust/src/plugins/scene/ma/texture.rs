//! Un nœud `file` de Maya vers une texture glTF.
//!
//! Le pilote ne décode rien lui-même : il nomme l'image par son URI, relativement à la racine où le
//! compilateur relira ces mêmes octets, et laisse le registre d'images dire si ce format se lit.
//! Une image absente, hors du dossier de la source ou hors du registre est comptée au rapport, et la
//! scène continue sans elle — jamais un échec de compilation.
//!
//! Maya écrit souvent un chemin absolu de la machine qui a exporté. Ce chemin n'existe pas ici, et
//! le suivre sortirait du dossier servi : seul son nom de fichier est retenu, cherché à la racine
//! des images puis dans `sourceimages`, le dossier que Maya donne aux textures d'un projet.
use super::*;

/// Le dossier qu'un projet Maya réserve aux textures.
const IMAGES_DIRECTORY: &str = "sourceimages";

/// La texture glTF branchée sur l'une de ces entrées d'un nœud, sous la forme que glTF attend d'un
/// emplacement de texture : `{"index": …}`.
pub(super) fn connected(world: &mut World<'_>, node: usize, names: &[&str]) -> Option<Value> {
    let source = world.graph.input(node, names).map(|(source, _)| source)?;
    of(world, source)
}

/// La texture glTF de ce nœud. Une entrée branchée sur autre chose qu'un nœud `file` — un calcul,
/// une rampe, un bruit — n'est pas une image : elle est comptée plutôt qu'évaluée.
pub(super) fn of(world: &mut World<'_>, node: usize) -> Option<Value> {
    let document = world.document;
    if document.nodes[node].kind != "file" {
        world.refuse(report::TEXTURE_UNSUPPORTED);
        return None;
    }
    let written = document.nodes[node]
        .attr(&["ftn", "fileTextureName"])
        .and_then(|attr| attr.texts().first().cloned())?;
    let index = image(world, &written)?;
    let mode = wrap(world, node);
    let sampler = world.scene.sampler(mode);
    Some(slot(world, index, sampler))
}

/// Le rang de l'image, versée à la première demande, ou rien quand le fichier ne se lit pas.
fn image(world: &mut World<'_>, written: &str) -> Option<usize> {
    let images = world.images;
    let Some((relative, decoder)) = candidates(written)
        .into_iter()
        .find_map(|path| readable(images, &path).map(|decoder| (path, decoder)))
    else {
        world.refuse(report::TEXTURE_MISSING);
        world.scene.report.notes.push(format!(
            "texture illisible ou hors registre d'images: {written}"
        ));
        return None;
    };
    if let Some(known) = world.images_by_uri.get(&relative) {
        return Some(*known);
    }
    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();
    // Une URI glTF, pas le chemin sous la racine : `%`, `#`, l'espace et tout ce qui n'est pas un
    // caractère non réservé s'échappe, sinon le consommateur relit un autre nom, ou rien.
    let uri = crate::uri::encode_relative(Path::new(&relative));
    world
        .scene
        .images
        .push(json!({"name":name,"mimeType":decoder,"uri":uri}));
    let index = world.scene.images.len() - 1;
    world.images_by_uri.insert(relative, index);
    Some(index)
}

/// Les chemins où chercher l'image sous la racine, dans l'ordre : le chemin écrit quand il est
/// relatif et sûr, puis son seul nom de fichier à la racine des images, puis ce nom sous
/// `sourceimages`.
fn candidates(written: &str) -> Vec<String> {
    let parts: Vec<&str> = written
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    let Some(name) = parts.last().filter(|name| crate::is_safe_source_name(name)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if !written.starts_with('/')
        && !written.contains(':')
        && parts.iter().all(|part| crate::is_safe_source_name(part))
    {
        out.push(parts.join("/"));
    }
    out.push((*name).to_string());
    out.push(format!("{IMAGES_DIRECTORY}/{name}"));
    out
}

/// Le type MIME du pilote d'image qui revendique cette URI sous la racine, quand le fichier y est.
fn readable(root: &Path, uri: &str) -> Option<&'static str> {
    let path = root.join(uri);
    crate::plugins::image::by_extension(&path)
        .filter(|_| path.is_file())
        .map(|decoder| decoder.mime())
}

/// Le rang de la texture qui lie cette image à cet échantillonneur, versée une seule fois.
fn slot(world: &mut World<'_>, source: usize, sampler: usize) -> Value {
    let entry = json!({"source":source,"sampler":sampler});
    let known = world.scene.textures.iter().position(|kept| *kept == entry);
    let index = known.unwrap_or_else(|| {
        world.scene.textures.push(entry);
        world.scene.count("textures", 1);
        world.scene.textures.len() - 1
    });
    json!({ "index": index })
}

/// Le mode de répétition, lu sur le `place2dTexture` branché sur les coordonnées du nœud `file`.
/// Maya répète par défaut : `wrapU` ou `wrapV` explicitement faux borne, et la scène intermédiaire
/// n'en porte qu'un par échantillonneur, donc c'est `wrapU` qui décide et `wrapV` qui suit.
fn wrap(world: &World<'_>, node: usize) -> u32 {
    let placed = world
        .graph
        .input(node, &["uv", "uvCoord"])
        .map(|(source, _)| &world.document.nodes[source]);
    let repeats = placed
        .and_then(|place| place.attr(&["wu", "wrapU"]))
        .and_then(Attr::flag)
        .unwrap_or(true);
    match repeats {
        true => 10497,
        false => 33071,
    }
}
