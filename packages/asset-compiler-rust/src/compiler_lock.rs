use super::*;

/// Le nom du verrou dans `<cache>/native`. La purge ne parcourt que `slice`, `full`, `imports` et
/// `objects` : un fichier posé à côté d'eux ne peut pas être effacé par une compilation.
const CACHE_LOCK_FILE: &str = ".lock";
/// Au-delà, une compilation en attente renonce plutôt que d'attendre sans fin.
const WAIT: std::time::Duration = std::time::Duration::from_secs(30);
/// Raccourcit l'attente ci-dessus, en millisecondes : un hôte qui préfère un refus immédiat, ou une
/// épreuve qui ne veut pas durer trente secondes, pose cette variable. Valeur illisible ignorée.
const WAIT_ENV: &str = "WG_CACHE_LOCK_WAIT_MS";
/// Un tour d'attente : assez court pour qu'une annulation soit lue sans délai sensible, assez long
/// pour que l'attente ne coûte rien.
const STEP: std::time::Duration = std::time::Duration::from_millis(20);

/// Exclusion mutuelle sur un cache. Un cache ne garde qu'un pointeur par scope et se purge après
/// chaque écriture : deux compilations qui l'écrivent en même temps effacent la clef et les objets
/// que l'autre vient de publier.
///
/// L'exclusion est celle que le système tient sur le fichier `<cache>/native/.lock` : elle suit le
/// processus et non le fichier, donc le système la relâche dès que son propriétaire meurt, y
/// compris tué net ou emporté par un redémarrage. Le fichier, lui, n'est jamais effacé : son
/// existence ne dit rien, seule sa prise compte, et effacer le fichier d'un vivant lui prendrait
/// son cache.
pub(super) struct CacheLock {
    file: File,
}

/// L'attente avant de renoncer, telle que la variable d'environnement la fixe, sinon `WAIT`.
fn wait() -> std::time::Duration {
    std::env::var(WAIT_ENV)
        .ok()
        .and_then(|value| value.parse().ok())
        .map_or(WAIT, std::time::Duration::from_millis)
}

impl CacheLock {
    pub(super) fn acquire(o: &Options) -> Result<Self> {
        let native = o.cache.join("native");
        fs::create_dir_all(&native)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(native.join(CACHE_LOCK_FILE))?;
        let deadline = Instant::now() + wait();
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(Self { file }),
                Err(fs::TryLockError::WouldBlock) => {}
                Err(fs::TryLockError::Error(error)) => return Err(error.into()),
            }
            if Instant::now() >= deadline {
                return Err(CompilerError::new(
                    "CACHE_LOCKED",
                    format!(
                        "Cache {} is being written by another compilation",
                        o.cache.display()
                    ),
                ));
            }
            std::thread::sleep(STEP);
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}
