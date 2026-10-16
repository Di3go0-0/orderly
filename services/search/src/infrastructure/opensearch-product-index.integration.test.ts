/**
 * Requiere OpenSearch local:  pnpm local:up && pnpm test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSearchClient, OpenSearchProductIndex } from './opensearch-product-index.js';

const url = process.env.OPENSEARCH_URL ?? 'http://localhost:9200';
const indexName = `products-test-${Date.now()}`;
const client = createOpenSearchClient(url, 'none');
const index = new OpenSearchProductIndex(client, indexName);

const doc = (id: string, name: string, stock: number, tags: string[] = []) => ({
  id, name, description: `${name} de prueba`, priceCents: 1000, stock, tags, updatedAt: new Date().toISOString(),
});

describe('OpenSearchProductIndex', () => {
  beforeAll(async () => {
    await index.ensureReady();
    await index.upsert(doc('1', 'Zapato rojo', 3, ['calzado']));
    await index.upsert(doc('2', 'Zapatilla deportiva', 0, ['calzado']));
    await index.upsert(doc('3', 'Taza de café', 10, ['hogar']));
  });

  afterAll(async () => {
    await client.indices.delete({ index: indexName });
  });

  it('finds by fuzzy text', async () => {
    const res = await index.search({ text: 'zapato', limit: 10, inStockOnly: false });
    expect(res.items.map((i) => i.id)).toContain('1');
    expect(res.items.map((i) => i.id)).not.toContain('3');
  });

  it('filters out-of-stock when asked', async () => {
    const res = await index.search({ text: 'zapat', limit: 10, inStockOnly: true });
    expect(res.items.map((i) => i.id)).toEqual(['1']);
  });

  it('remove is idempotent', async () => {
    await index.remove('3');
    await expect(index.remove('3')).resolves.toBeUndefined();
    const res = await index.search({ text: 'taza', limit: 10, inStockOnly: false });
    expect(res.total).toBe(0);
  });
});
