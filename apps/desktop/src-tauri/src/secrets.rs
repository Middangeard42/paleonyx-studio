use keyring::Entry;

/// Namespace for our entries in the OS credential store. Stable, because
/// changing it would orphan every key a user has already added.
const SERVICE: &str = "studio.paleonyx.desktop";

/// Provider ids we will store a key for.
///
/// An allowlist rather than a free-form string: these commands are
/// reachable from the webview, and without it a bug — or anything that
/// managed to run in the webview — could write to or read arbitrary
/// entries in the user's credential store, including ones belonging to
/// other applications.
const ALLOWED_PROVIDERS: &[&str] = &["openrouter", "groq"];

fn entry_for(provider: &str) -> Result<Entry, String> {
    if !ALLOWED_PROVIDERS.contains(&provider) {
        return Err(format!("Unknown provider '{provider}'."));
    }
    Entry::new(SERVICE, provider).map_err(|e| format!("Could not open credential store: {e}"))
}

#[tauri::command]
pub fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("The key is empty.".to_string());
    }
    entry_for(&provider)?
        .set_password(trimmed)
        .map_err(|e| format!("Could not save the key: {e}"))
}

/// Reports whether a key exists, without returning it.
///
/// This is what the UI asks. Rendering "key added" must never require
/// handing the secret to the interface that only wants to draw a
/// checkmark.
#[tauri::command]
pub fn has_provider_key(provider: String) -> Result<bool, String> {
    match entry_for(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Could not read the credential store: {e}")),
    }
}

/// Returns the key itself, for the moment a request is being made.
///
/// Callers are expected to use it immediately and hold no reference —
/// `packages/runtime`'s remote adapter fetches per request rather than
/// caching, so the secret is never parked in application state.
///
/// This is the one place a key crosses into the webview, and it is a
/// deliberate trade: the alternative is proxying every model request
/// through Rust, which would keep the secret out of JS entirely but put
/// an HTTP client and a streaming bridge in the shell. Worth revisiting
/// as hardening; noted in CLAUDE.md §4.2 rather than left implicit.
#[tauri::command]
pub fn get_provider_key(provider: String) -> Result<Option<String>, String> {
    match entry_for(&provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the credential store: {e}")),
    }
}

/// Removes a key. Deleting one that isn't there succeeds: the caller
/// asked for the key to be gone, and it is.
#[tauri::command]
pub fn delete_provider_key(provider: String) -> Result<(), String> {
    match entry_for(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}
