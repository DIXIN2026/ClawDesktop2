/**
 * Credential Management
 * OS keychain storage for API keys with lazy initialization
 */
import { safeStorage, dialog } from 'electron';

const CREDENTIAL_PREFIX = 'clawdesktop2:';
const SECRET_KEY_PREFIX = 'secret:';

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

async function storeEncryptedValue(key: string, value: string): Promise<void> {
  const store = await getStore();
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value);
    store.set(`${CREDENTIAL_PREFIX}${key}`, encrypted.toString('base64'));
    return;
  }

  console.warn(
    `[SECURITY WARNING] OS keychain encryption unavailable. ` +
    `Credential "${key}" stored WITHOUT encryption.`,
  );
  dialog.showMessageBox({
    type: 'warning',
    title: '安全警告',
    message: 'OS 密钥链加密不可用',
    detail: `敏感信息将以明文方式存储在本地配置文件中。这可能导致安全风险。建议确保操作系统的密钥链服务正常运行。`,
    buttons: ['我已了解'],
  }).catch(() => { /* dialog may fail in headless mode */ });
  store.set(`${CREDENTIAL_PREFIX}${key}`, value);
}

async function readEncryptedValue(key: string): Promise<string | undefined> {
  const store = await getStore();
  const stored = store.get(`${CREDENTIAL_PREFIX}${key}`);
  if (!stored) return undefined;

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(stored, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      console.error(
        `[ERROR] Failed to decrypt credential "${key}". ` +
        `The stored credential may be corrupted.`,
        err instanceof Error ? err.message : String(err),
      );
      return undefined;
    }
  }

  return stored;
}

function makeSecretKey(secretId: string): string {
  return `${SECRET_KEY_PREFIX}${secretId}`;
}

export async function storeSecret(secretId: string, secret: string): Promise<void> {
  await storeEncryptedValue(makeSecretKey(secretId), secret);
}

export async function getSecret(secretId: string): Promise<string | undefined> {
  return readEncryptedValue(makeSecretKey(secretId));
}

export async function deleteSecret(secretId: string): Promise<void> {
  const store = await getStore();
  store.delete(`${CREDENTIAL_PREFIX}${makeSecretKey(secretId)}`);
}

export async function hasSecret(secretId: string): Promise<boolean> {
  const store = await getStore();
  return store.has(`${CREDENTIAL_PREFIX}${makeSecretKey(secretId)}`);
}

export async function storeApiKey(providerId: string, apiKey: string): Promise<void> {
  await storeEncryptedValue(providerId, apiKey);
}

export async function getApiKey(providerId: string): Promise<string | undefined> {
  return readEncryptedValue(providerId);
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
    .map(k => k.slice(CREDENTIAL_PREFIX.length))
    .filter(k => !k.startsWith(SECRET_KEY_PREFIX));
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
