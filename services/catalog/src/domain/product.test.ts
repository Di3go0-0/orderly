import { describe, expect, it } from 'vitest';
import { InvariantError } from '@orderly/shared';
import { Product } from './product.js';

const now = new Date('2026-01-01T00:00:00Z');
const base = { id: 'p1', name: '  Zapato rojo ', description: 'd', priceCents: 1999, stock: 5, tags: ['Rojo', 'rojo', ' calzado '] };

describe('Product', () => {
  it('normalizes name and tags on create', () => {
    const p = Product.create(base, now).snapshot();
    expect(p.name).toBe('Zapato rojo');
    expect(p.tags).toEqual(['rojo', 'calzado']);
    expect(p.createdAt).toBe(now.toISOString());
  });

  it('rejects negative price or stock and non-integers', () => {
    expect(() => Product.create({ ...base, priceCents: -1 }, now)).toThrow(InvariantError);
    expect(() => Product.create({ ...base, stock: 1.5 }, now)).toThrow(InvariantError);
    expect(() => Product.create({ ...base, name: '   ' }, now)).toThrow(InvariantError);
  });

  it('update keeps invariants and bumps updatedAt', () => {
    const p = Product.create(base, now);
    const later = new Date('2026-01-02T00:00:00Z');
    p.update({ stock: 0, priceCents: 2500 }, later);
    expect(p.snapshot()).toMatchObject({ stock: 0, priceCents: 2500, updatedAt: later.toISOString(), createdAt: now.toISOString() });
    expect(() => p.update({ stock: -3 }, later)).toThrow(InvariantError);
  });
});
