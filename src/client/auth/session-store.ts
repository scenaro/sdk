export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  get length(): number;
}

export function createBrowserStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export interface SessionStoreKeys {
  userToken: string;
  userId: string;
  applicationId: string;
  externalId: string;
  scenarioUuid: string;
  sessionPrefix: string;
}

export function buildStorageKeys(prefix = ''): SessionStoreKeys {
  const p = prefix ? `${prefix}_` : '';
  return {
    userToken: `${p}scenaro_user_token`,
    userId: `${p}scenaro_user_id`,
    applicationId: `${p}scenaro_application_id`,
    externalId: `${p}scenaro_external_id`,
    scenarioUuid: `${p}scenaro_scenario_uuid`,
    sessionPrefix: `${p}scenaro_session:`,
  };
}

/** Legacy keys used by platform-spa before SDK unification. */
export const LEGACY_KEYS = {
  userToken: 'user_token',
  externalId: 'external_id',
} as const;

const APP_SESSION_PREFIX_SUFFIX = 'app:';

export function getScenarioSessionKey(prefix: string, scenarioUUID: string): string {
  return `${prefix}${scenarioUUID}`;
}

export function getAppSessionKey(prefix: string, applicationId: number | string): string {
  return `${prefix}${APP_SESSION_PREFIX_SUFFIX}${applicationId}`;
}

export interface SessionBlob {
  external_id?: string;
  user_token?: string;
  user_id?: number;
  application_id?: number;
  /** Legacy field on scenario-scoped blobs, dropped during migration to app-scoped sessions. */
  scenario_uuid?: string;
}

export function readJsonSession(
  storage: StorageAdapter | null,
  key: string,
): SessionBlob | null {
  if (!storage || !key) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionBlob;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJsonSession(
  storage: StorageAdapter | null,
  key: string,
  patch: SessionBlob,
): void {
  if (!storage || !key) return;
  const current = readJsonSession(storage, key) || {};
  storage.setItem(key, JSON.stringify({ ...current, ...patch }));
}

function listAppSessionEntries(
  storage: StorageAdapter,
  keys: SessionStoreKeys,
): Array<{ applicationId: number; session: SessionBlob }> {
  const entries: Array<{ applicationId: number; session: SessionBlob }> = [];
  const prefix = `${keys.sessionPrefix}${APP_SESSION_PREFIX_SUFFIX}`;

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const applicationId = parseInt(key.slice(prefix.length), 10);
    if (!Number.isFinite(applicationId)) continue;
    const session = readJsonSession(storage, key);
    if (session) entries.push({ applicationId, session });
  }

  return entries;
}

function removeFlatKeys(storage: StorageAdapter, keys: SessionStoreKeys): void {
  storage.removeItem(keys.userToken);
  storage.removeItem(keys.userId);
  storage.removeItem(keys.applicationId);
  storage.removeItem(keys.externalId);
}

function readFlatIdentity(
  storage: StorageAdapter,
  keys: SessionStoreKeys,
): SessionBlob | null {
  const user_token = storage.getItem(keys.userToken) ?? storage.getItem(LEGACY_KEYS.userToken);
  const external_id = storage.getItem(keys.externalId) ?? storage.getItem(LEGACY_KEYS.externalId);
  const user_id_raw = storage.getItem(keys.userId);
  const application_id_raw = storage.getItem(keys.applicationId);

  if (!user_token && !external_id && !user_id_raw && !application_id_raw) return null;

  const user_id = user_id_raw ? parseInt(user_id_raw, 10) : undefined;
  const application_id = application_id_raw ? parseInt(application_id_raw, 10) : undefined;

  return {
    user_token: user_token ?? undefined,
    external_id: external_id ?? undefined,
    user_id: Number.isFinite(user_id) ? user_id : undefined,
    application_id: Number.isFinite(application_id) ? application_id : undefined,
  };
}

function migrateFlatToAppSession(
  storage: StorageAdapter,
  keys: SessionStoreKeys,
): SessionBlob | null {
  const flat = readFlatIdentity(storage, keys);
  if (!flat?.application_id || !flat.user_token) return flat;

  writeJsonSession(storage, getAppSessionKey(keys.sessionPrefix, flat.application_id), flat);
  removeFlatKeys(storage, keys);
  storage.removeItem(LEGACY_KEYS.userToken);
  storage.removeItem(LEGACY_KEYS.externalId);
  return flat;
}

function migrateLegacyScenarioBlob(
  storage: StorageAdapter,
  keys: SessionStoreKeys,
  scenarioUUID: string,
): SessionBlob | null {
  const legacy = readJsonSession(
    storage,
    getScenarioSessionKey(keys.sessionPrefix, scenarioUUID),
  );
  if (!legacy) return null;

  if (legacy.application_id) {
    const { scenario_uuid: _drop, ...identity } = legacy;
    writeJsonSession(
      storage,
      getAppSessionKey(keys.sessionPrefix, legacy.application_id),
      identity,
    );
  }

  storage.removeItem(getScenarioSessionKey(keys.sessionPrefix, scenarioUUID));
  return legacy;
}

/** Canonical app-scoped session (source of truth). */
export function getAppSession(
  storage: StorageAdapter | null,
  keys: SessionStoreKeys,
  options: { applicationId?: number | null; scenarioUUID?: string | null } = {},
): SessionBlob | null {
  if (!storage) return null;

  const { applicationId, scenarioUUID } = options;

  migrateFlatToAppSession(storage, keys);

  if (applicationId) {
    return readJsonSession(storage, getAppSessionKey(keys.sessionPrefix, applicationId));
  }

  if (scenarioUUID) {
    const migrated = migrateLegacyScenarioBlob(storage, keys, scenarioUUID);
    if (migrated?.application_id) {
      return readJsonSession(
        storage,
        getAppSessionKey(keys.sessionPrefix, migrated.application_id),
      );
    }

    const activeScenario = storage.getItem(keys.scenarioUuid);
    if (activeScenario === scenarioUUID) {
      const appSessions = listAppSessionEntries(storage, keys);
      if (appSessions.length === 1) return appSessions[0].session;
      if (appSessions.length > 1) return appSessions[0].session;
    }
  }

  const appSessions = listAppSessionEntries(storage, keys);
  if (appSessions.length === 1) return appSessions[0].session;
  return null;
}

export interface PersistIdentityInput {
  user_token: string;
  user_id: number;
  application_id: number;
  external_id?: string;
}

export function persistIdentity(
  storage: StorageAdapter | null,
  keys: SessionStoreKeys,
  scenarioUUID: string | null,
  identity: PersistIdentityInput,
  externalId?: string,
): void {
  if (!storage) return;

  const ext = identity.external_id || externalId;
  const patch: SessionBlob = {
    external_id: ext,
    user_token: identity.user_token,
    user_id: identity.user_id,
    application_id: identity.application_id,
  };

  if (identity.application_id) {
    writeJsonSession(
      storage,
      getAppSessionKey(keys.sessionPrefix, identity.application_id),
      patch,
    );
  }

  if (scenarioUUID) {
    storage.setItem(keys.scenarioUuid, scenarioUUID);
    storage.removeItem(getScenarioSessionKey(keys.sessionPrefix, scenarioUUID));
  }

  removeFlatKeys(storage, keys);
  storage.removeItem(LEGACY_KEYS.userToken);
  storage.removeItem(LEGACY_KEYS.externalId);
}

export function getUserToken(
  storage: StorageAdapter | null,
  keys: SessionStoreKeys,
  scenarioUUID?: string | null,
  applicationId?: number | null,
): string | null {
  const session = getAppSession(storage, keys, { scenarioUUID, applicationId });
  return session?.user_token ?? null;
}

export function resolveExternalId(
  storage: StorageAdapter | null,
  keys: SessionStoreKeys,
  scenarioUUID: string | null,
  externalId?: string | null,
): string {
  if (externalId) return externalId;
  if (!storage) {
    return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  const session = getAppSession(storage, keys, { scenarioUUID });
  if (session?.external_id) return session.external_id;

  return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function clearSession(
  storage: StorageAdapter | null,
  keys: SessionStoreKeys,
  scenarioUUID?: string | null,
): void {
  if (!storage) return;

  if (scenarioUUID) {
    const session = getAppSession(storage, keys, { scenarioUUID });
    if (session?.application_id) {
      storage.removeItem(getAppSessionKey(keys.sessionPrefix, session.application_id));
    }
    storage.removeItem(getScenarioSessionKey(keys.sessionPrefix, scenarioUUID));
    if (storage.getItem(keys.scenarioUuid) === scenarioUUID) {
      storage.removeItem(keys.scenarioUuid);
    }
    removeFlatKeys(storage, keys);
    return;
  }

  storage.removeItem(keys.scenarioUuid);
  removeFlatKeys(storage, keys);
  storage.removeItem(LEGACY_KEYS.userToken);
  storage.removeItem(LEGACY_KEYS.externalId);

  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(keys.sessionPrefix)) toRemove.push(key);
  }
  toRemove.forEach((k) => storage.removeItem(k));
}
