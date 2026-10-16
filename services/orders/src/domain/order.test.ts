import { describe, expect, it } from 'vitest';
import { InvariantError } from '@orderly/shared';
import { Order } from './order.js';

const now = new Date('2026-01-01T00:00:00Z');
const lines = [
  { productId: 'p1', name: 'Taza', quantity: 2, unitPriceCents: 500 },
  { productId: 'p2', name: 'Plato', quantity: 1, unitPriceCents: 1200 },
];

describe('Order', () => {
  it('starts PENDING with the computed total', () => {
    const o = Order.place({ id: 'o1', customerId: 'c1', lines }, now);
    expect(o.status).toBe('PENDING');
    expect(o.snapshot().totalCents).toBe(2200);
  });

  it('rejects empty orders, bad quantities and duplicated products', () => {
    expect(() => Order.place({ id: 'o1', customerId: 'c1', lines: [] }, now)).toThrow(InvariantError);
    expect(() => Order.place({ id: 'o1', customerId: 'c1', lines: [{ ...lines[0]!, quantity: 0 }] }, now)).toThrow(InvariantError);
    expect(() => Order.place({ id: 'o1', customerId: 'c1', lines: [lines[0]!, lines[0]!] }, now)).toThrow(InvariantError);
  });

  it('only transitions out of PENDING once', () => {
    const o = Order.place({ id: 'o1', customerId: 'c1', lines }, now);
    o.confirm(now);
    expect(o.status).toBe('CONFIRMED');
    expect(() => o.reject('late', now)).toThrow(InvariantError);
    expect(() => o.confirm(now)).toThrow(InvariantError);
  });

  it('reject stores the reason', () => {
    const o = Order.place({ id: 'o1', customerId: 'c1', lines }, now);
    o.reject('Insufficient stock for p1', now);
    expect(o.snapshot()).toMatchObject({ status: 'REJECTED', rejectionReason: 'Insufficient stock for p1' });
  });
});
