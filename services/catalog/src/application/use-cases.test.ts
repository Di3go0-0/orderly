import { describe, expect, it } from 'vitest';
import { FixedClock, NotFoundError, SequenceIds } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { Product } from '../domain/product.js';
import type { ProductRepository } from '../domain/product-repository.js';
import { CreateProduct, DeleteProduct, UpdateProduct } from './use-cases.js';

/** Repositorio en memoria: el mismo contrato que DynamoDB, sin red. */
class InMemoryProductRepository implements ProductRepository {
  readonly items = new Map<string, Product>();
  readonly outbox: DomainEvent[] = [];
  async findById(id: string) {
    const p = this.items.get(id);
    return p ? Product.rehydrate(p.snapshot()) : null;
  }
  async create(p: Product, events: DomainEvent[]) {
    this.items.set(p.id, p);
    this.outbox.push(...events);
  }
  async update(p: Product, events: DomainEvent[]) {
    this.items.set(p.id, p);
    this.outbox.push(...events);
  }
  async delete(id: string, events: DomainEvent[]) {
    this.items.delete(id);
    this.outbox.push(...events);
  }
}

const deps = () => ({ repo: new InMemoryProductRepository(), clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), ids: new SequenceIds() });

describe('catalog use cases', () => {
  it('CreateProduct stores the product and emits ProductCreated in the same write', async () => {
    const d = deps();
    const out = await new CreateProduct(d).execute({ name: 'Taza', description: '', priceCents: 500, stock: 3, tags: [] });
    expect(out.id).toBe('id-1');
    expect(d.repo.items.has('id-1')).toBe(true);
    expect(d.repo.outbox).toHaveLength(1);
    expect(d.repo.outbox[0]).toMatchObject({ eventType: 'ProductCreated', source: 'catalog', aggregateId: 'id-1' });
  });

  it('UpdateProduct emits ProductUpdated with the new snapshot', async () => {
    const d = deps();
    const { id } = await new CreateProduct(d).execute({ name: 'Taza', description: '', priceCents: 500, stock: 3, tags: [] });
    const out = await new UpdateProduct(d).execute(id, { stock: 10 });
    expect(out.stock).toBe(10);
    expect(d.repo.outbox.at(-1)).toMatchObject({ eventType: 'ProductUpdated', payload: { product: { stock: 10 } } });
  });

  it('Update/Delete of a missing product throw NotFoundError', async () => {
    const d = deps();
    await expect(new UpdateProduct(d).execute('nope', { stock: 1 })).rejects.toThrow(NotFoundError);
    await expect(new DeleteProduct(d).execute('nope')).rejects.toThrow(NotFoundError);
  });
});
