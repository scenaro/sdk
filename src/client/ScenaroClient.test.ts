import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScenaroApiError,
  ScenaroClient,
  getUserBucket,
  listCollectionItems,
  listConversationMessages,
} from './index';
import type { StorageAdapter } from './auth/session-store';

function memoryStorage(): StorageAdapter {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Minimal JWT with far-future exp so isTokenExpired is false. */
function fakeToken(payload: Record<string, unknown> = {}): string {
  const body = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...payload,
  };
  const encode = (value: object) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${encode({ alg: 'none' })}.${encode(body)}.sig`;
}

function mockIdentifyFlow(fetchMock: ReturnType<typeof vi.fn>, opts: {
  applicationId: number;
  userId?: number;
  externalId?: string;
  token?: string;
}) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ application_id: opts.applicationId }));
  fetchMock.mockResolvedValueOnce(jsonResponse({
    user_token: opts.token ?? fakeToken({ application_id: opts.applicationId }),
    user_id: opts.userId ?? 1,
    application_id: opts.applicationId,
    external_id: opts.externalId,
  }));
}

describe('ScenaroClient public resources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes auth and builds collection item query parameters', async () => {
    const token = fakeToken({ application_id: 3 });
    const fetchMock = vi.fn();
    mockIdentifyFlow(fetchMock, { applicationId: 3, token, externalId: 'external-1' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'wine-1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage: memoryStorage(),
    });
    await client.identifyUser('scenario-1', 'external-1');

    const result = await listCollectionItems(client, 4, 9, {
      limit: 25,
      query: 'rouge',
      matchField: 'source.sku',
      matchValue: 'A,B',
    });

    expect(result.data).toEqual([{ id: 'wine-1' }]);
    const [url, init] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://api.example/v1/public/companies/4/collections/9/items?offset=0&limit=25&q=rouge&mode=full_text&field=title&match_field=source.sku&match_value=A%2CB',
    );
    expect((init.headers as Record<string, string>).Authorization)
      .toBe(`Bearer ${token}`);
  });

  it('normalizes wrapped bucket and descending conversation messages', async () => {
    const fetchMock = vi.fn();
    mockIdentifyFlow(fetchMock, { applicationId: 3 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { data: { days: [] } } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'new' }, { id: 'old' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage: memoryStorage(),
    });
    await client.identifyUser('scenario-1', 'external-1');

    expect(await getUserBucket(client, 39, 3)).toEqual({ data: { days: [] } });
    expect(
      await listConversationMessages(client, 'conv-1', { order: 'desc', limit: 5 }),
    ).toEqual([{ id: 'old' }, { id: 'new' }]);
  });

  it('throws a typed API error with status and response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: 'forbidden' }, 403),
    ));
    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage: memoryStorage(),
    });

    await expect(
      client.request('/public/memories', { requiresAuth: false }),
    ).rejects.toMatchObject({
      name: 'ScenaroApiError',
      status: 403,
      body: { error: 'forbidden' },
    } satisfies Partial<ScenaroApiError>);
  });

  it('forwards session metadata to POST /public/session', async () => {
    const fetchMock = vi.fn();
    mockIdentifyFlow(fetchMock, { applicationId: 3 });
    fetchMock.mockResolvedValueOnce(jsonResponse({
      token: 'lk-token',
      url: 'wss://livekit.example',
      room_name: 'room-1',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage: memoryStorage(),
    });
    await client.identifyUser('scenario-1', 'external-1');

    const metadata = {
      dog: { name: 'Milo', age_years: 3 },
      capsule_id: 'first-meeting',
    };
    await client.startSession('scenario-1', {
      language: 'fr-FR',
      sessionOptions: { metadata },
    });

    const [, init] = fetchMock.mock.calls[2] as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      metadata?: Record<string, unknown>;
      scenario_uuid?: string;
    };
    expect(body.scenario_uuid).toBe('scenario-1');
    expect(body.metadata).toEqual(metadata);
  });

  it('omits empty metadata from the session request body', async () => {
    const fetchMock = vi.fn();
    mockIdentifyFlow(fetchMock, { applicationId: 3 });
    fetchMock.mockResolvedValueOnce(jsonResponse({
      token: 'lk-token',
      url: 'wss://livekit.example',
      room_name: 'room-1',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage: memoryStorage(),
    });
    await client.identifyUser('scenario-1', 'external-1');
    await client.startSession('scenario-1', {
      sessionOptions: { metadata: {} },
    });

    const [, init] = fetchMock.mock.calls[2] as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as { metadata?: unknown };
    expect(body.metadata).toBeUndefined();
  });

  it('keeps other app tokens and mints a distinct guest for a new application', async () => {
    const storage = memoryStorage();
    const shakaToken = fakeToken({ application_id: 38 });
    storage.setItem(
      'scenaro_session:app:38',
      JSON.stringify({
        user_token: shakaToken,
        user_id: 2439,
        application_id: 38,
        external_id: 'guest-shaka',
      }),
    );
    storage.setItem('scenaro_scenario_app:shaka-pub', '38');

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ application_id: 35 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({
      user_token: fakeToken({ application_id: 35 }),
      user_id: 99,
      application_id: 35,
      external_id: 'guest-urban',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage,
    });
    await client.identifyUser('urbansider-pub');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const versionUrl = String(fetchMock.mock.calls[0][0]);
    expect(versionUrl).toContain('/public/publications/urbansider-pub/version');
    const [, tokenInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect((tokenInit.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(String(tokenInit.body)) as {
      external_id?: string;
      scenario_uuid?: string;
    };
    expect(body.scenario_uuid).toBe('urbansider-pub');
    expect(body.external_id).toBeTruthy();
    expect(body.external_id).not.toBe('guest-shaka');
    expect(storage.getItem('scenaro_session:app:38')).toContain('guest-shaka');
    expect(storage.getItem('scenaro_session:app:35')).toBeTruthy();
  });

  it('reuses the cached token when returning to the same application', async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn();
    const shakaToken = fakeToken({ application_id: 38 });
    mockIdentifyFlow(fetchMock, {
      applicationId: 38,
      userId: 1,
      externalId: 'guest-a',
      token: shakaToken,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ application_id: 35 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({
      user_token: fakeToken({ application_id: 35 }),
      user_id: 2,
      application_id: 35,
      external_id: 'guest-b',
    }));
    // Return to SHAKA: only publication version (map may already exist → zero or one call)
    vi.stubGlobal('fetch', fetchMock);

    const client = new ScenaroClient({
      apiUrl: 'https://api.example',
      storage,
    });
    await client.identifyUser('shaka-pub', 'guest-a');
    await client.identifyUser('urbansider-pub');
    const beforeReturn = fetchMock.mock.calls.length;
    const again = await client.identifyUser('shaka-pub');

    expect(again.application_id).toBe(38);
    expect(again.user_token).toBe(shakaToken);
    // No extra /public/token — only optional version lookup if map missing (map exists).
    expect(fetchMock.mock.calls.length).toBe(beforeReturn);
    expect(storage.getItem('scenaro_session:app:38')).toContain('guest-a');
    expect(storage.getItem('scenaro_session:app:35')).toContain('guest-b');
  });
});
