import { useCallback, useState } from "react";

/**
 * A small UI preference persisted across sessions (e.g. DESIGN.md §6.3's
 * "show too-large models" toggle, which must not reset every time the
 * screen opens).
 *
 * Strictly for non-sensitive display state. Credentials never come near
 * this — BYOK keys go to OS-native secure storage only (CLAUDE.md §4.2,
 * §9).
 */
export function useLocalPreference<T>(
  key: string,
  fallback: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : (JSON.parse(stored) as T);
    } catch {
      // Corrupt or unavailable storage is not worth failing a render
      // over; the fallback is always a usable default.
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Preference just won't persist this session. Nothing user-facing
        // breaks, so there is no error state to surface here.
      }
    },
    [key]
  );

  return [value, update];
}
