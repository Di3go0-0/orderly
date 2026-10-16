import { describe, expect, it } from 'vitest';
import { createEvent } from '@orderly/shared';
import type { ProductDocument, ProductIndex, SearchQuery } from '../domain/product-index.js';
import { ProjectProductEvent } from './use-cases.js';

class InMemoryIndex implements ProductIndex {
  readonly docs = new Map<string, ProductDocument>();
  async ensureReady() {}
  async upsert(doc: ProductDocument) {
    this.docs.set(doc.id, doc);
  }
  async remove(id: string) {
    this.docs.delete(id);
  }
  async search(q: SearchQuery) {
    const items = [...this.docs.values()].filter((d) => d.name.toLowerCase().includes(q.text.toLowerCase()));
    return { items, total: items.length };
  }
}

const product = { id: 'p1', name: 'Taza', description: '', priceCents: 500, stock: 2, tags: ['hogar'], createdAt: 't', updatedAt: 't' };

describe('ProjectProductEvent', () => {
  it('upserts on ProductCreated/Updated and removes on ProductDeleted', async () => {
    const index = new InMemoryIndex();
    const project = new ProjectProductEvent(index);
    await project.execute(createEvent({ eventType: 'ProductCreated', source: 'catalog', aggregateId: 'p1', payload: { product } }));
    expect(index.docs.get('p1')).toMatchObject({ name: 'Taza', stock: 2 });
    expect(index.docs.get('p1')).not.toHaveProperty('createdAt');

    await project.execute(createEvent({ eventType: 'ProductUpdated', source: 'catalog', aggregateId: 'p1', payload: { product: { ...product, stock: 0 } } }));
    expect(index.docs.get('p1')?.stock).toBe(0);

    await project.execute(createEvent({ eventType: 'ProductDeleted', source: 'catalog', aggregateId: 'p1', payload: { productId: 'p1' } }));
    expect(index.docs.has('p1')).toBe(false);
  });

  it('ignores unknown events without throwing', async () => {
    const project = new ProjectProductEvent(new InMemoryIndex());
    await expect(project.execute(createEvent({ eventType: 'Whatever', source: 'x', aggregateId: 'y', payload: {} }))).resolves.toBeUndefined();
  });
});
