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
    Entry::new(SERVICE, provider).map_err(|e| describe("open the credential store", &e))
}

/// What to tell someone whose credential store could not be used.
#[cfg(target_os = "linux")]
const STORE_HINT: &str =
    "Saved keys need a Secret Service, such as GNOME Keyring or KWallet, running in your desktop session.";
#[cfg(not(target_os = "linux"))]
const STORE_HINT: &str = "The operating system's credential store did not respond.";

/// Says why a credential-store call failed, in words a person can act on.
///
/// A store that could not be used is by far the likeliest failure, and the
/// library's own wording for it ("Platform secure storage failure: DBus
/// error ...") says nothing about what to do. Its detail stays in
/// brackets for whoever has to diagnose it. Every other failure keeps the
/// library's description. There is no fallback to storing the key
/// somewhere else (CLAUDE.md §4.2).
fn describe(action: &str, error: &keyring::Error) -> String {
    match error {
        keyring::Error::PlatformFailure(detail) | keyring::Error::NoStorageAccess(detail) => {
            format!("Could not {action}: the credential store could not be used. {STORE_HINT} ({detail})")
        }
        other => format!("Could not {action}: {other}"),
    }
}

#[tauri::command]
pub fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("The key is empty.".to_string());
    }
    entry_for(&provider)?
        .set_password(trimmed)
        .map_err(|e| describe("save the key", &e))
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
        Err(e) => Err(describe("check for a saved key", &e)),
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
        Err(e) => Err(describe("read the saved key", &e)),
    }
}

/// Removes a key. Deleting one that isn't there succeeds: the caller
/// asked for the key to be gone, and it is.
#[tauri::command]
pub fn delete_provider_key(provider: String) -> Result<(), String> {
    match entry_for(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(describe("remove the key", &e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn platform_failure(detail: &str) -> keyring::Error {
        keyring::Error::PlatformFailure(detail.into())
    }

    /// The regression: on a Linux machine with no Secret Service the user
    /// was shown "Platform secure storage failure: DBus error: Unable to
    /// autolaunch a dbus-daemon without a $DISPLAY for X11" and nothing
    /// about what to do.
    #[test]
    fn a_missing_credential_store_says_so_and_keeps_the_detail() {
        let detail = "Unable to autolaunch a dbus-daemon without a $DISPLAY for X11";
        let message = describe("save the key", &platform_failure(detail));
        assert!(message.starts_with("Could not save the key: "), "{message}");
        assert!(message.contains("credential store"), "{message}");
        assert!(message.contains(detail), "{message}");
        assert!(
            !message.contains("Platform secure storage failure"),
            "{message}"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn on_linux_it_names_what_provides_a_credential_store() {
        let message = describe("save the key", &platform_failure("no bus"));
        assert!(message.contains("Secret Service"), "{message}");
        assert!(message.contains("GNOME Keyring"), "{message}");
    }

    #[test]
    fn storage_that_cannot_be_reached_reads_the_same_way() {
        let error = keyring::Error::NoStorageAccess("locked".into());
        let message = describe("save the key", &error);
        assert!(
            message.contains("credential store could not be used"),
            "{message}"
        );
        assert!(message.contains("locked"), "{message}");
    }

    /// Only a missing store gets the special wording. Any other failure
    /// keeps its own description rather than being called a missing store.
    #[test]
    fn other_failures_keep_their_own_words() {
        let message = describe(
            "save the key",
            &keyring::Error::TooLong("password".into(), 100),
        );
        assert!(message.contains("password"), "{message}");
        assert!(!message.contains("Secret Service"), "{message}");
        assert!(!message.contains("could not be used"), "{message}");
    }
}
