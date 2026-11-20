// Encrypts secrets (refresh tokens, the OAuth client secret) with the operating system's protection:
// DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux.
import { safeStorage } from 'electron';

const PREFIX = 'enc1:';

export function seal(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return PREFIX + safeStorage.encryptString(plain).toString('base64');
  }
  // No OS key store available (rare; some Linux setups). Stored obfuscated, never logged.
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}

export function unseal(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    if (stored.startsWith(PREFIX)) return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch {
    return null;
  }
  return null;
}
