//! Du fichier demandé à la scène intermédiaire écrite dans le cache.
//!
//! Le fichier est lu en entier, puis découpé en commandes, puis appliqué à un document, puis
//! converti. Rien n'est écrit à côté de la source : la scène part sous `request.cache`, à une clé
//! qui tient l'empreinte des octets lus, de sorte qu'un fichier inchangé se réécrive à l'identique
//! au même endroit et qu'un fichier modifié n'hérite jamais de ce que le précédent avait écrit.
use super::*;

/// Lit le fichier et écrit sa conversion dans le cache.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = source_file(request.inputs)?;
    let bytes = usize::try_from(size(file)?).unwrap_or(usize::MAX);
    (request.progress)(json!({"phase":"import-source","step":"scan","plugin":NAME,"bytes":bytes}));
    let source = fs::read(file)?;
    let digest = crate::hash(&source);
    let mut document = document::read(&text(file, source)?)?;
    let graph = shading::resolve(&mut document);
    let mut scene = Scene::new(plugin);
    scene.read_file(
        &file.file_name().unwrap_or_default().to_string_lossy(),
        bytes,
        &digest,
    );
    carry(&document.report, &mut scene.report);
    let counts = build::scene(&document, &graph, &mut scene, request);
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Import cancelled"));
    }
    if !scene.nodes.iter().any(|node| node.get("mesh").is_some()) {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            format!("ma: {} carries no visible polygonal mesh", file.display()),
        ));
    }
    let directory = request
        .cache
        .join("native")
        .join("imports")
        .join(scene.key());
    let written = scene.write(plugin, &directory, file, started)?;
    (request.progress)(
        json!({"phase":"import-source","step":"complete","plugin":NAME,
        "counts":counts,"ms":crate::shared_math::elapsed_ms(started)}),
    );
    Ok(written)
}

/// La taille du fichier, refusée au-delà du plafond du pilote plutôt que lue.
fn size(file: &Path) -> Result<u64> {
    let bytes = fs::metadata(file)?.len();
    if bytes > MAX_BYTES {
        return Err(CompilerError::new(
            SIZE_UNSUPPORTED,
            format!(
                "ma: {} is {bytes} bytes, above the {MAX_BYTES} byte ceiling this reader admits",
                file.display()
            ),
        ));
    }
    Ok(bytes)
}

/// Le texte des octets lus, déjà hachés. Un fichier qui n'est pas de l'UTF-8 est refusé par son
/// nom : un `.ma` est un texte, et en deviner l'encodage changerait les noms qu'il porte.
fn text(file: &Path, bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| {
        CompilerError::new(
            FILE_INVALID,
            format!("ma: {} is not valid UTF-8 text", file.display()),
        )
    })
}

/// Verse le rapport de la lecture du document dans celui de la scène : les deux étapes comptent les
/// mêmes raisons, et le manifeste n'en publie qu'une table.
fn carry(from: &Report, into: &mut Report) {
    for (reason, count) in &from.unsupported {
        into.add_count(reason, *count);
    }
    into.notes.extend(from.notes.iter().cloned());
}
