//! Pilote `.unitypackage`, conteneur. Le paquet n'est pas une scène : c'est un projet Unity mis à
//! plat, un dossier par asset. Ce pilote reconstruit l'arbre `Assets/…` sous le cache, puis route ce
//! dossier comme n'importe quelle source — il rend ce que le pilote de scène retenu rend, en
//! pratique `unity`. Rien n'est réencodé : chaque fichier ressort avec ses octets d'origine, et la
//! licence de chaque fichier reste celle de son auteur.
//!
//! Structure, telle que l'éditeur la documente : une archive tar compressée en gzip, dont chaque
//! entrée de premier niveau est un dossier nommé par le GUID de l'asset. Ce dossier porte
//! `pathname` — le chemin cible dans le projet, sur sa première ligne —, `asset` — les octets du
//! fichier, absent quand l'entrée décrit un dossier du projet —, `asset.meta` — les métadonnées
//! d'import — et parfois `preview.png`, une vignette de l'éditeur qui n'appartient pas au projet et
//! qu'on laisse donc de côté.
//!
//! Provenance : format d'archive ouvert (POSIX 1003.1-1988 ustar, RFC 1952 pour gzip), lu par les
//! caisses `tar` 0.4.46 et `flate2` 1.1.10 (MIT OU Apache-2.0), en décompression seule, `flate2` sur
//! son backend Rust pur et `tar` sans `xattr`. Aucun code, SDK ni bibliothèque d'éditeur n'entre
//! ici, et rien n'est déchiffré ni contourné.
use super::*;
use crate::{is_safe_source_name, CompilerError};
use flate2::read::GzDecoder;
use std::{
    collections::BTreeMap,
    fs,
    io::{BufReader, Read},
};

pub(super) static UNITYPACKAGE: UnityPackage = UnityPackage;
pub(super) struct UnityPackage;

/// Le nombre magique de gzip (RFC 1952) : tout paquet commence par là.
const GZIP_MAGIC: &[u8] = b"\x1f\x8b";
/// Le chemin cible de l'asset dans le projet, première ligne du fichier.
const PATHNAME: &str = "pathname";
/// Les octets du fichier. Son absence dans un dossier de GUID désigne un dossier du projet.
const ASSET: &str = "asset";
/// Les métadonnées d'import, posées à côté de l'asset sous le nom que l'éditeur leur donne.
const META: &str = "asset.meta";
/// Plafond de lecture d'un `pathname` : au-delà, l'entrée ne porte pas un chemin de projet.
const MAX_PATHNAME_BYTES: u64 = 64 * 1024;

impl Plugin for UnityPackage {
    fn name(&self) -> &'static str {
        "unitypackage"
    }
    /// Le conteneur ne lit aucune géométrie : cette version nomme l'extracteur, pas un décodeur.
    fn version(&self) -> &'static str {
        "unitypackage-ustar-gzip-tar-0.4.46-flate2-1.1.10-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["unitypackage"]
    }
}

impl ScenePlugin for UnityPackage {
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(GZIP_MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        archive::container(request, self, |file, root| extract(request, file, root))
    }
}

/// Ce qu'un dossier de GUID annonce : le chemin cible, et s'il porte des octets d'asset.
#[derive(Default)]
struct Target {
    path: String,
    file: bool,
}

/// Reconstruit l'arbre du projet sous `root` et rend le nombre d'entrées et le total écrit.
///
/// Deux passes, comme tout conteneur : la première lit le paquet entier pour juger ses chemins
/// cibles et ses plafonds sans rien écrire, la seconde le relit pour écrire. Un paquet refusé ne
/// laisse donc aucun fichier derrière lui. Le flux gzip n'étant pas rembobinable, la seconde passe
/// rouvre le fichier plutôt que de garder les octets des assets en mémoire.
fn extract(request: &SceneRequest<'_>, source: &Path, root: &Path) -> Result<(usize, u64)> {
    let (targets, entries) = index(request, source, root)?;
    if targets.is_empty() {
        return Err(archive::empty(source));
    }
    let mut archive = open(source)?;
    let mut written = 0u64;
    for entry in archive.entries().map_err(unreadable(source))? {
        archive::check(request)?;
        let mut entry = entry.map_err(unreadable(source))?;
        let Some((guid, member)) = split(&entry) else {
            continue;
        };
        let Some(target) = targets.get(&guid) else {
            continue;
        };
        // Le `.meta` de l'éditeur se pose à côté de ce qu'il décrit, dossier du projet compris.
        let destination = match member.as_str() {
            ASSET => archive::safe_join(root, &target.path)?,
            META => archive::safe_join(root, &format!("{}.meta", target.path))?,
            _ => continue,
        };
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let room = archive::LIMITS.bytes - written;
        let mut out = fs::File::create(&destination)?;
        written += std::io::copy(&mut Read::take(&mut entry, room + 1), &mut out)
            .map_err(unreadable(source))?;
        archive::under_byte_limit(written)?;
    }
    ended(archive, source)?;
    for target in targets.values().filter(|target| !target.file) {
        fs::create_dir_all(archive::safe_join(root, &target.path)?)?;
    }
    Ok((entries, written))
}

/// Première passe : le chemin cible de chaque GUID, jugé avant la moindre écriture, et le nombre
/// d'entrées lues. Une entrée qui n'est pas un fichier ordinaire — lien symbolique ou matériel —
/// arrête tout : elle désignerait hors de l'extraction.
fn index(
    request: &SceneRequest<'_>,
    source: &Path,
    root: &Path,
) -> Result<(BTreeMap<String, Target>, usize)> {
    let mut archive = open(source)?;
    let mut targets: BTreeMap<String, Target> = BTreeMap::new();
    let (mut entries, mut declared) = (0usize, 0u64);
    for entry in archive.entries().map_err(unreadable(source))? {
        archive::check(request)?;
        let mut entry = entry.map_err(unreadable(source))?;
        entries += 1;
        archive::under_entry_limit(entries)?;
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err(CompilerError::new(
                archive::SYMLINK,
                format!(
                    "archive entry {:?} is a link",
                    String::from_utf8_lossy(&entry.path_bytes())
                ),
            ));
        }
        declared = declared.saturating_add(entry.size());
        archive::under_byte_limit(declared)?;
        let Some((guid, member)) = split(&entry) else {
            continue;
        };
        match member.as_str() {
            PATHNAME => {
                let path = first_line(&mut entry).map_err(unreadable(source))?;
                // Le chemin cible vient du paquet : il est jugé ici, avant toute écriture, par la
                // même règle que n'importe quelle entrée d'archive.
                archive::safe_join(root, &path)?;
                targets.entry(guid).or_default().path = path;
            }
            ASSET => targets.entry(guid).or_default().file = true,
            _ => {}
        }
    }
    ended(archive, source)?;
    // Un dossier de GUID sans `pathname` n'a pas de place dans le projet : il n'est pas écrit.
    targets.retain(|_, target| !target.path.is_empty());
    Ok((targets, entries))
}

/// Le paquet ouvert : le flux gzip déballé au fil de la lecture, lu comme une archive tar.
fn open(source: &Path) -> Result<tar::Archive<GzDecoder<BufReader<fs::File>>>> {
    let file = BufReader::new(fs::File::open(source)?);
    Ok(tar::Archive::new(GzDecoder::new(file)))
}

/// Lit ce qui reste du flux après la dernière entrée du tar : le pied de gzip, qui porte le condensé
/// CRC32 des octets déballés et leur nombre (RFC 1952). `tar` s'arrête avant lui, et sans cette
/// lecture un paquet tronqué ou au pied menteur passerait pour entier.
fn ended<R: Read>(archive: tar::Archive<R>, source: &Path) -> Result<()> {
    std::io::copy(&mut archive.into_inner(), &mut std::io::sink()).map_err(unreadable(source))?;
    Ok(())
}

/// Le GUID et le membre d'une entrée `<guid>/<membre>`. Une entrée plus profonde, posée à la racine
/// du paquet ou nommée hors des noms de source sûrs n'appartient pas à la structure documentée :
/// elle n'est pas reconstruite.
fn split<R: Read>(entry: &tar::Entry<'_, R>) -> Option<(String, String)> {
    let path = entry.path().ok()?;
    let mut parts = path.components();
    let guid = parts.next()?.as_os_str().to_str()?.to_string();
    let member = parts.next()?.as_os_str().to_str()?.to_string();
    (parts.next().is_none() && is_safe_source_name(&guid)).then_some((guid, member))
}

/// La première ligne de `pathname`, qui porte le chemin cible ; l'éditeur peut en écrire une
/// seconde, l'ancien chemin d'un asset déplacé, dont le projet reconstruit n'a que faire.
fn first_line(entry: &mut impl Read) -> std::io::Result<String> {
    let mut text = String::new();
    Read::take(entry, MAX_PATHNAME_BYTES).read_to_string(&mut text)?;
    Ok(text.lines().next().unwrap_or_default().trim().to_string())
}

/// Le refus d'un paquet que `tar` n'ouvre pas : un gzip tronqué ou corrompu arrive ici en erreur
/// d'entrée-sortie, et sort nommé `ARCHIVE_UNREADABLE` sans qu'un octet ait été écrit.
fn unreadable(source: &Path) -> impl Fn(std::io::Error) -> CompilerError + '_ {
    move |error| archive::unreadable(source, error)
}
