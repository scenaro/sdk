import { describe, expect, it } from 'vitest';
import { resolveRpcMethodName } from '../../protocol/rpc';
import { isTokenExpired } from './jwt';
import {
  buildStorageKeys,
  clearSession,
  getAppSession,
  getUserToken,
  persistIdentity,
  resolveExternalId,
} from './session-store';

function createMemoryStorage() {
  const storage = new Map<string, string>();
  return {
    storage,
    adapter: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
      get length() {
        return storage.size;
      },
    },
  };
}

describe('protocol rpc', () => {
  it('prefers frontend_method over tool name', () => {
    expect(
      resolveRpcMethodName({ name: 'launch_search', frontend_method: 'custom_launch' }),
    ).toBe('custom_launch');
    expect(resolveRpcMethodName({ name: 'launch_search' })).toBe('launch_search');
  });
});

describe('jwt', () => {
  it('treats missing token as expired', () => {
    expect(isTokenExpired(null)).toBe(true);
  });
});

describe('session-store', () => {
  it('resolves stable external id from app session', () => {
    const { adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    persistIdentity(adapter, keys, 'scenario-1', {
      user_token: 'tok',
      user_id: 1,
      application_id: 42,
      external_id: 'user-123',
    });
    expect(resolveExternalId(adapter, keys, 'scenario-1')).toBe('user-123');
  });

  it('persists identity only to app-scoped key and scenario pointer', () => {
    const { storage, adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    persistIdentity(adapter, keys, 'pub-uuid', {
      user_token: 'tok',
      user_id: 1,
      application_id: 42,
      external_id: 'ext-1',
    });

    expect(storage.get(keys.userToken)).toBeUndefined();
    expect(storage.get(keys.userId)).toBeUndefined();
    expect(storage.get(keys.applicationId)).toBeUndefined();
    expect(storage.get(keys.externalId)).toBeUndefined();
    expect(storage.get(keys.scenarioUuid)).toBe('pub-uuid');
    expect(storage.get(`${keys.sessionPrefix}pub-uuid`)).toBeUndefined();
    expect(storage.get(`${keys.sessionPrefix}app:42`)).toContain('ext-1');
    expect(storage.get(`${keys.sessionPrefix}app:42`)).toContain('tok');
  });

  it('reads token from app session', () => {
    const { adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    persistIdentity(adapter, keys, 'pub-uuid', {
      user_token: 'tok',
      user_id: 1,
      application_id: 42,
      external_id: 'ext-1',
    });
    expect(getUserToken(adapter, keys, 'pub-uuid')).toBe('tok');
    expect(getAppSession(adapter, keys, { applicationId: 42 })?.user_id).toBe(1);
  });

  it('migrates flat keys into app session on read', () => {
    const { storage, adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    storage.set(keys.userToken, 'legacy-tok');
    storage.set(keys.userId, '7');
    storage.set(keys.applicationId, '2');
    storage.set(keys.externalId, 'guest-1');
    storage.set(keys.scenarioUuid, 'scenario-a');

    expect(getUserToken(adapter, keys, 'scenario-a')).toBe('legacy-tok');
    expect(storage.get(keys.userToken)).toBeUndefined();
    expect(storage.get(`${keys.sessionPrefix}app:2`)).toContain('legacy-tok');
  });

  it('migrates legacy scenario blob into app session on read', () => {
    const { storage, adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    storage.set(
      `${keys.sessionPrefix}old-scenario`,
      JSON.stringify({
        user_token: 'tok',
        user_id: 3,
        application_id: 9,
        external_id: 'ext-9',
      }),
    );
    storage.set(keys.scenarioUuid, 'old-scenario');

    expect(getUserToken(adapter, keys, 'old-scenario')).toBe('tok');
    expect(storage.get(`${keys.sessionPrefix}old-scenario`)).toBeUndefined();
    expect(storage.get(`${keys.sessionPrefix}app:9`)).toContain('ext-9');
  });

  it('clears app session and scenario pointer for a scenario', () => {
    const { storage, adapter } = createMemoryStorage();
    const keys = buildStorageKeys('');
    persistIdentity(adapter, keys, 'pub-uuid', {
      user_token: 'tok',
      user_id: 1,
      application_id: 42,
      external_id: 'ext-1',
    });

    clearSession(adapter, keys, 'pub-uuid');

    expect(storage.get(`${keys.sessionPrefix}app:42`)).toBeUndefined();
    expect(storage.get(keys.scenarioUuid)).toBeUndefined();
  });
});
