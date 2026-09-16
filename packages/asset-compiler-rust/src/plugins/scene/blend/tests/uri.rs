//! Le nom d'une image seulement désignée, tel qu'il entre dans la scène intermédiaire.
use super::*;

/// Un nom de fichier légal sur le disque et interdit tel quel dans une URI.
const AWKWARD: &str = "co%lor #1 rouge.png";

// Comportement : une image que le fichier désigne sans l'emporter est nommée par une URI, pas par
// son chemin. `%`, `#` et l'espace s'échappent, sinon le consommateur relit un autre nom, ou rien ;
// et ce qui est écrit se redécode exactement en ce que Blender avait écrit.
#[test]
fn a_linked_image_is_named_by_an_escaped_uri() {
    let root = Path::new("/projet/scene");
    let declared = format!("//textures/{AWKWARD}");
    let uri = images::linked(&declared, root).expect("l'image est sous la racine servie");
    assert_eq!(uri, "textures/co%25lor%20%231%20rouge.png");
    assert_eq!(
        crate::uri::decode(&uri).as_deref(),
        Some(format!("textures/{AWKWARD}").as_str())
    );
}
