#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use winreg::enums::*;
use winreg::RegKey;

const PROGID: &str = "MDViewLite.md";
const APP_KEY: &str = "mdview-lite.exe";
const EXTENSIONS: [&str; 3] = [".md", ".markdown", ".mdx"];

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
}

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

fn notify_shell() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::UI::Shell::SHChangeNotify(
            0x0800_0000, // SHCNE_ASSOCCHANGED
            0x0000,      // SHCNF_IDLIST
            std::ptr::null(),
            std::ptr::null(),
        );
    }
}

#[tauri::command]
fn install_association() -> Result<String, String> {
    let exe = exe_path()?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (classes, _) = hkcu
        .create_subkey("Software\\Classes")
        .map_err(|e| e.to_string())?;

    let (progid, _) = classes
        .create_subkey(PROGID)
        .map_err(|e| e.to_string())?;
    progid
        .set_value("", &"Markdown Document")
        .map_err(|e| e.to_string())?;
    let (icon, _) = progid.create_subkey("DefaultIcon").map_err(|e| e.to_string())?;
    icon.set_value("", &format!("{exe},0"))
        .map_err(|e| e.to_string())?;
    let (cmd, _) = progid
        .create_subkey("shell\\open\\command")
        .map_err(|e| e.to_string())?;
    cmd.set_value("", &format!("\"{exe}\" \"%1\""))
        .map_err(|e| e.to_string())?;

    for ext in EXTENSIONS {
        let (ext_key, _) = classes.create_subkey(ext).map_err(|e| e.to_string())?;
        let current: String = ext_key.get_value("").unwrap_or_default();
        if current.is_empty() {
            ext_key
                .set_value("", &PROGID)
                .map_err(|e| e.to_string())?;
        }
        let (owp, _) = ext_key
            .create_subkey("OpenWithProgids")
            .map_err(|e| e.to_string())?;
        owp.set_value(PROGID, &"")
            .map_err(|e| e.to_string())?;
    }

    let (app, _) = classes
        .create_subkey(format!("Applications\\{APP_KEY}"))
        .map_err(|e| e.to_string())?;
    app.set_value("FriendlyAppName", &"MDView Lite")
        .map_err(|e| e.to_string())?;
    let (app_cmd, _) = app
        .create_subkey("shell\\open\\command")
        .map_err(|e| e.to_string())?;
    app_cmd
        .set_value("", &format!("\"{exe}\" \"%1\""))
        .map_err(|e| e.to_string())?;
    let (supported, _) = app
        .create_subkey("SupportedTypes")
        .map_err(|e| e.to_string())?;
    for ext in EXTENSIONS {
        supported.set_value(ext, &"").map_err(|e| e.to_string())?;
    }

    notify_shell();
    Ok(exe)
}

#[tauri::command]
fn uninstall_association() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let classes = hkcu
        .open_subkey_with_flags("Software\\Classes", KEY_ALL_ACCESS)
        .map_err(|e| e.to_string())?;

    for ext in EXTENSIONS {
        if let Ok(ext_key) = classes.open_subkey_with_flags(ext, KEY_ALL_ACCESS) {
            if let Ok(owp) = ext_key.open_subkey_with_flags("OpenWithProgids", KEY_ALL_ACCESS) {
                let _ = owp.delete_value(PROGID);
            }
            let current: String = ext_key.get_value("").unwrap_or_default();
            if current == PROGID {
                let _ = ext_key.delete_value("");
            }
        }
    }

    let _ = classes.delete_subkey_all(PROGID);
    let _ = classes.delete_subkey_all(format!("Applications\\{APP_KEY}"));

    notify_shell();
    Ok(())
}

#[tauri::command]
fn registration_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(classes) = hkcu.open_subkey("Software\\Classes") else {
        return false;
    };
    let app_ok = classes
        .open_subkey(format!("Applications\\{APP_KEY}\\shell\\open\\command"))
        .is_ok();
    let progid_ok = classes.open_subkey(PROGID).is_ok();
    app_ok || progid_ok
}

#[tauri::command]
fn association_status() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(classes) = hkcu.open_subkey("Software\\Classes") else {
        return false;
    };
    let app_ok = classes
        .open_subkey(format!("Applications\\{APP_KEY}\\shell\\open\\command"))
        .is_ok();
    let progid_ok = classes.open_subkey(PROGID).is_ok();
    if !(app_ok && progid_ok) {
        return false;
    }

    let user_choice: String = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice")
        .and_then(|k| k.get_value("ProgId"))
        .unwrap_or_default();
    if !user_choice.is_empty() {
        return user_choice == PROGID;
    }

    let md_default: String = classes
        .open_subkey(".md")
        .and_then(|k| k.get_value(""))
        .unwrap_or_default();
    md_default == PROGID
}

#[tauri::command]
fn open_default_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let op: Vec<u16> = "open\0".encode_utf16().collect();
        let uri: Vec<u16> = "ms-settings:defaultapps\0".encode_utf16().collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                uri.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if (result as isize) > 32 {
            Ok(())
        } else {
            Err(format!("无法打开系统设置: {}", result as isize))
        }
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            initial_file,
            install_association,
            uninstall_association,
            registration_status,
            association_status,
            open_default_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
