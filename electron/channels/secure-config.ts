import { getSecret, storeSecret } from '../security/credential.js';

export type ConfigurableChannelId = 'qq' | 'feishu' | 'feishu2' | 'email';

const CHANNEL_SECRET_FIELDS: Record<ConfigurableChannelId, readonly string[]> = {
  qq: ['clientSecret'],
  feishu: ['appSecret', 'encryptKey', 'verificationToken'],
  feishu2: ['appSecret', 'encryptKey', 'verificationToken'],
  email: ['password'],
};

function makeSecretStorageId(channelId: ConfigurableChannelId, field: string): string {
  return `channel:${channelId}:${field}`;
}

export function isConfigurableChannelId(value: string): value is ConfigurableChannelId {
  return value === 'qq' || value === 'feishu' || value === 'feishu2' || value === 'email';
}

export async function sanitizeChannelConfigForStorage(
  channelId: ConfigurableChannelId,
  config: Record<string, unknown>,
): Promise<{ sanitizedConfig: Record<string, unknown>; removedSecretFields: string[] }> {
  const sanitizedConfig: Record<string, unknown> = { ...config };
  const removedSecretFields: string[] = [];
  const secretFields = CHANNEL_SECRET_FIELDS[channelId];

  for (const field of secretFields) {
    if (!(field in sanitizedConfig)) continue;

    const value = sanitizedConfig[field];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        await storeSecret(makeSecretStorageId(channelId, field), trimmed);
      }
      removedSecretFields.push(field);
      delete sanitizedConfig[field];
      continue;
    }

    removedSecretFields.push(field);
    delete sanitizedConfig[field];
  }

  return {
    sanitizedConfig,
    removedSecretFields,
  };
}

export async function hydrateChannelConfigSecrets(
  channelId: ConfigurableChannelId,
  config: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const hydrated: Record<string, unknown> = { ...(config ?? {}) };
  const secretFields = CHANNEL_SECRET_FIELDS[channelId];

  for (const field of secretFields) {
    const current = hydrated[field];
    if (typeof current === 'string' && current.trim().length > 0) {
      continue;
    }
    const secret = await getSecret(makeSecretStorageId(channelId, field));
    if (typeof secret === 'string' && secret.length > 0) {
      hydrated[field] = secret;
    }
  }

  return hydrated;
}
