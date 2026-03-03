/**
 * Credential Management
 * OS keychain storage for API keys with lazy initialization
 */
import { safeStorage, dialog } from 'electron';

const CREDENTIAL_PREFIX = 'clawdesktop2:';

interface CredentialStore {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  store: Record<string, string>;
}

let credStore: CredentialStore | null = null;

async function getStore(): Promise<CredentialStore> {
  if (!credStore) {
    const Store = (await import('electron-store')).default;
    const instance = new Store<Record<string, string>>({ name: 'credentials' });
    credStore = {
      get: (key: string) => instance.get(key),
      set: (key: string, value: string) => { instance.set(key, value); },
      delete: (key: string) => { instance.delete(key); },
      has: (key: string) => instance.has(key),
      get store() { return instance.store; },
    };
  }
  return credStore;
}

export async function storeApiKey(providerId: string, apiKey: string): Promise<void> {
  const store = await getStore();
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(apiKey);
    store.set(`${CREDENTIAL_PREFIX}${providerId}`, encrypted.toString('base64'));
  } else {
    console.warn(
      `[SECURITY WARNING] OS keychain encryption unavailable. ` +
      `API key for "${providerId}" stored WITHOUT encryption.`,
    );
    // Notify the user about the security risk
    dialog.showMessageBox({
      type: 'warning',
      title: '安全警告',
      message: 'OS 密钥链加密不可用',
      detail: `API Key 将以明文方式存储在本地配置文件中。这可能导致安全风险。建议确保操作系统的密钥链服务正常运行。`,
      buttons: ['我已了解'],
    }).catch(() => { /* dialog may fail in headless mode */ });
    store.set(`${CREDENTIAL_PREFIX}${providerId}`, apiKey);
  }
}

export async function getApiKey(providerId: string): Promise<string | undefined> {
  const store = await getStore();
  const stored = store.get(`${CREDENTIAL_PREFIX}${providerId}`);
  if (!stored) return undefined;

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(stored, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      console.error(
        `[ERROR] Failed to decrypt API key for "${providerId}". ` +
        `The stored credential may be corrupted. Re-enter the key in Settings.`,
        err instanceof Error ? err.message : String(err),
      );
      return undefined;
    }
  }

  return stored;
}

export async function deleteApiKey(providerId: string): Promise<void> {
  const store = await getStore();
  store.delete(`${CREDENTIAL_PREFIX}${providerId}`);
}

export async function hasApiKey(providerId: string): Promise<boolean> {
  const store = await getStore();
  return store.has(`${CREDENTIAL_PREFIX}${providerId}`);
}

export async function listStoredProviders(): Promise<string[]> {
  const store = await getStore();
  const allKeys = Object.keys(store.store);
  return allKeys
    .filter(k => k.startsWith(CREDENTIAL_PREFIX))
    .map(k => k.slice(CREDENTIAL_PREFIX.length));
}

/** Filter credentials from log output */
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let redacted = text;
  for (const value of Object.values(secrets)) {
    if (value.length > 4) {
      redacted = redacted.replaceAll(value, `***${value.slice(-4)}`);
    } else if (value.length > 0) {
      // Redact short secrets completely
      redacted = redacted.replaceAll(value, '****');
    }
  }
  return redacted;
}
