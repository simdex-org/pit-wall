#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(feature = "portable")]
mod portable;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct Bridge(Arc<Mutex<Option<Running>>>);

fn clean(p: PathBuf) -> PathBuf {
    PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\"))
}

#[cfg(feature = "portable")]
fn resource(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    Ok(clean(portable::root(app)?.join(rel)))
}

#[cfg(not(feature = "portable"))]
fn resource(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let installed = app.path().resource_dir().map_err(|e| e.to_string())?.join("resources").join(rel);
    if installed.exists() {
        return Ok(clean(installed));
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join(rel);
    if dev.exists() {
        return Ok(clean(dev));
    }
    Err(format!("{rel} is missing, run pnpm prepare:resources"))
}

fn bridge_command(app: &AppHandle, args: &[String]) -> Result<Command, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = resource(app, "")?;
    let mut cmd = Command::new(resource(app, "node/node.exe")?);
    cmd.arg(root.join("bridge").join("bridge.mjs"))
        .args(args)
        .env("PITWALL_WEB", root.join("web"))
        .env("PITWALL_TRACKS", data.join("tracks"))
        .env("PITWALL_UPDATE", data.join("update"));
    #[cfg(feature = "portable")]
    cmd.env("PITWALL_PORTABLE", "1");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    Ok(cmd)
}

fn forward_lines<R: Read + Send + 'static>(app: &AppHandle, source: Option<R>) {
    let Some(source) = source else { return };
    let app = app.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
            let _ = app.emit("bridge-line", String::from_utf8_lossy(&buf).trim_end().to_string());
            buf.clear();
        }
    });
}

#[tauri::command]
fn bridge_start(app: AppHandle, state: State<Bridge>, args: Vec<String>) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_some() {
        return Err("Pit Wall is already running".into());
    }
    let mut all = args;
    all.push("--control-stdin".into());
    let mut cmd = bridge_command(&app, &all)?;
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take();
    forward_lines(&app, child.stdout.take());
    forward_lines(&app, child.stderr.take());
    *slot = Some(Running { child, stdin });

    let shared = state.0.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(200));
        let mut slot = shared.lock().unwrap();
        let Some(running) = slot.as_mut() else { break };
        if let Ok(Some(status)) = running.child.try_wait() {
            *slot = None;
            drop(slot);
            let _ = app.emit("bridge-exit", status.code().unwrap_or(-1));
            break;
        }
    });
    Ok(())
}

#[tauri::command]
fn bridge_stop(state: State<Bridge>) {
    let mut slot = state.0.lock().unwrap();
    let Some(running) = slot.as_mut() else { return };
    if let Some(mut stdin) = running.stdin.take() {
        let _ = stdin.write_all(b"quit\n");
    }
    let pid = running.child.id();
    let shared = state.0.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        if let Some(running) = shared.lock().unwrap().as_mut() {
            if running.child.id() == pid {
                let _ = running.child.kill();
            }
        }
    });
}

#[tauri::command]
fn bridge_running(state: State<Bridge>) -> bool {
    state.0.lock().unwrap().is_some()
}

#[tauri::command]
async fn bridge_tool(app: AppHandle, args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = bridge_command(&app, &args)?.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("failed").to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/** Runs the downloaded installer, or swaps the portable exe for the new one and starts it; then closes. */
#[tauri::command]
fn apply_update(app: AppHandle, state: State<Bridge>, file: String) -> Result<(), String> {
    kill_bridge(&state);
    #[cfg(feature = "portable")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let old = exe.with_extension("exe.old");
        let _ = std::fs::remove_file(&old);
        std::fs::rename(&exe, &old).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::copy(&file, &exe) {
            let _ = std::fs::rename(&old, &exe);
            return Err(e.to_string());
        }
        Command::new(&exe).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(feature = "portable"))]
    Command::new(&file).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<Bridge>) {
    kill_bridge(&state);
    app.exit(0);
}

fn kill_bridge(state: &Bridge) {
    if let Some(running) = state.0.lock().unwrap().as_mut() {
        let _ = running.child.kill();
    }
}

fn main() {
    #[cfg(feature = "portable")]
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Bridge::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let running = window.state::<Bridge>().0.lock().unwrap().is_some();
                if running {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![bridge_start, bridge_stop, bridge_running, bridge_tool, apply_update, quit_app])
        .build(tauri::generate_context!())
        .expect("could not start Pit Wall")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_bridge(&app.state::<Bridge>());
            }
        });
}
