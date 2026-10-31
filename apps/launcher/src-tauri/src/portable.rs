use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static ARCHIVE: &[u8] = include_bytes!("../resources.zip");
static ROOT: OnceLock<Result<PathBuf, String>> = OnceLock::new();

/** Where Node, the bridge and the page were unpacked; unpacks them on the first call of a new build. */
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    ROOT.get_or_init(|| unpack(app)).clone()
}

fn unpack(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("portable");
    let mut hasher = DefaultHasher::new();
    ARCHIVE.hash(&mut hasher);
    let name = format!("{:016x}", hasher.finish());
    let dir = base.join(&name);
    if !dir.join(".done").exists() {
        let _ = fs::remove_dir_all(&dir);
        zip::ZipArchive::new(Cursor::new(ARCHIVE))
            .and_then(|mut zip| zip.extract(&dir))
            .map_err(|e| format!("could not unpack Pit Wall: {e}"))?;
        fs::write(dir.join(".done"), "").map_err(|e| e.to_string())?;
    }
    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten().filter(|e| e.file_name().to_string_lossy() != name) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
    Ok(dir)
}
