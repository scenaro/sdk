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

describe('ScenaroClient public resources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes auth and builds collection item query parameters', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        user_token: 'header.e30.signature',
        user_id: 1,
        application_id: 3,
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'wine-1' }] }));
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
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://api.example/v1/public/companies/4/collections/9/items?offset=0&limit=25&q=rouge&mode=full_text&field=title&match_field=source.sku&match_value=A%2CB',
    );
    expect((init.headers as Record<string, string>).Authorization)
      .toBe('Bearer header.e30.signature');
  });

  it('normalizes wrapped bucket and descending conversation messages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        user_token: 'header.e30.signature',
        user_id: 1,
        application_id: 3,
      }))
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
});
