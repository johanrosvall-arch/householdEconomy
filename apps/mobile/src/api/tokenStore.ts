import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Where session tokens live.
 *
 * On a device this is SecureStore — Keychain on iOS, Keystore on Android. A
 * session here reads a household's entire financial history, so it deserves
 * the same storage a banking app would use.
 *
 * On web there is no equivalent. SecureStore is native-only and throws in a
 * browser, so the web build falls back to localStorage.
 *
 * That fallback is a real downgrade, not a detail: anything that can run
 * JavaScript on the page can read localStorage, so an XSS bug becomes full
 * account access. It is an acceptable trade for a proof of concept served over
 * localhost to a single user. Before this web build is exposed to anyone else,
 * tokens should move to an httpOnly, SameSite=Strict cookie set by the API,
 * which JavaScript cannot read at all.
 */

const isWeb = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      // Safari in private mode throws on localStorage access.
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage unavailable or full — the session simply will not persist
      // across reloads, which is survivable.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* nothing useful to do */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
