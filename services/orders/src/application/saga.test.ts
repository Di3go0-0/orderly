/**
 * Prueba la SAGA completa en memoria: PlaceOrder -> ReserveStock -> Confirm/Reject.
 * Sin AWS: los puertos se implementan con Maps.
 */
import { describe, expect, it } from 'vitest';
import { FixedClock, InMemoryEventPublisher, NotFoundError, SequenceIds } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { Order } from '../domain/order.js';
import type { Inventory, OrderRepository, ProductLookup, ReserveResult } from '../domain/ports.js';
import type { OrderPlacedPayload, StockRejectedPayload, StockReservedPayload } from '../domain/events.js';
import { PlaceOrder } from './place-order.js';
import { ReserveStock } from './reserve-stock.js';
import { ConfirmOrder, GetOrder, RejectOrder } from './order-lifecycle.js';

class InMemoryIdempotencyStore {
  private readonly seen = new Set<string>();
  async claim(consumer: string, eventId: string) {
    const key = `${consumer}#${eventId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

class InMemoryOrders implements OrderRepository {
  readonly items = new Map<string, Order>();
  readonly outbox: DomainEvent[] = [];
  async findById(id: string) {
    const o = this.items.get(id);
    return o ? Order.rehydrate(o.snapshot()) : null;
  }
  async listByCustomer(customerId: string) {
    return [...this.items.values()].filter((o) => o.customerId === customerId);
  }
  async create(o: Order, events: DomainEvent[]) {
    this.items.set(o.id, o);
    this.outbox.push(...events);
  }
  async update(o: Order, events: DomainEvent[]) {
    this.items.set(o.id, o);
    this.outbox.push(...events);
  }
}

class InMemoryCatalog implements ProductLookup, Inventory {
  constructor(readonly stock: Map<string, { name: string; priceCents: number; stock: number }>) {}
  async findMany(ids: string[]) {
    return ids.flatMap((id) => {
      const p = this.stock.get(id);
      return p ? [{ id, name: p.name, priceCents: p.priceCents }] : [];
    });
  }
  async reserve(productId: string, quantity: number): Promise<ReserveResult> {
    const p = this.stock.get(productId);
    if (!p) return 'missing';
    if (p.stock < quantity) return 'insufficient';
    p.stock -= quantity;
    return 'reserved';
  }
  async release(productId: string, quantity: number) {
    const p = this.stock.get(productId);
    if (p) p.stock += quantity;
  }
}

function setup() {
  const catalog = new InMemoryCatalog(
    new Map([
      ['p1', { name: 'Taza', priceCents: 500, stock: 5 }],
      ['p2', { name: 'Plato', priceCents: 1200, stock: 1 }],
    ]),
  );
  const orders = new InMemoryOrders();
  const publisher = new InMemoryEventPublisher();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
  const ids = new SequenceIds();
  return {
    catalog,
    orders,
    publisher,
    placeOrder: new PlaceOrder({ orders, products: catalog, clock, ids }),
    reserveStock: new ReserveStock({ inventory: catalog, publisher, idempotency: new InMemoryIdempotencyStore(), clock, ids }),
    confirmOrder: new ConfirmOrder({ orders, clock, ids }),
    rejectOrder: new RejectOrder({ orders, clock, ids }),
  };
}

describe('order saga', () => {
  it('happy path: PENDING -> StockReserved -> CONFIRMED, stock decremented', async () => {
    const s = setup();
    const order = await s.placeOrder.execute({ customerId: 'c1', lines: [{ productId: 'p1', quantity: 2 }] });
    expect(order.status).toBe('PENDING');
    expect(order.totalCents).toBe(1000);
    const placed = s.orders.outbox[0] as DomainEvent<OrderPlacedPayload>;
    expect(placed.eventType).toBe('OrderPlaced');

    await expect(s.reserveStock.execute(placed)).resolves.toBe('reserved');
    expect(s.catalog.stock.get('p1')?.stock).toBe(3);
    const reserved = s.publisher.published[0] as DomainEvent<StockReservedPayload>;
    expect(reserved.eventType).toBe('StockReserved');

    await s.confirmOrder.execute(reserved);
    expect((await s.orders.findById(order.id))?.status).toBe('CONFIRMED');
    expect(s.orders.outbox.at(-1)?.eventType).toBe('OrderConfirmed');
  });

  it('compensation: second line fails, first line is released, order REJECTED', async () => {
    const s = setup();
    const order = await s.placeOrder.execute({
      customerId: 'c1',
      lines: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 5 }, // solo hay 1
      ],
    });
    const placed = s.orders.outbox[0] as DomainEvent<OrderPlacedPayload>;
    await expect(s.reserveStock.execute(placed)).resolves.toBe('rejected');
    expect(s.catalog.stock.get('p1')?.stock).toBe(5); // devuelto
    expect(s.catalog.stock.get('p2')?.stock).toBe(1); // intacto
    const rejected = s.publisher.published[0] as DomainEvent<StockRejectedPayload>;
    expect(rejected.eventType).toBe('StockRejected');

    await s.rejectOrder.execute(rejected);
    expect((await s.orders.findById(order.id))?.snapshot()).toMatchObject({ status: 'REJECTED', rejectionReason: expect.stringContaining('p2') });
  });

  it('idempotency: the same OrderPlaced delivered twice only reserves once', async () => {
    const s = setup();
    await s.placeOrder.execute({ customerId: 'c1', lines: [{ productId: 'p1', quantity: 1 }] });
    const placed = s.orders.outbox[0] as DomainEvent<OrderPlacedPayload>;
    await s.reserveStock.execute(placed);
    await expect(s.reserveStock.execute(placed)).resolves.toBe('duplicate');
    expect(s.catalog.stock.get('p1')?.stock).toBe(4);
    expect(s.publisher.published).toHaveLength(1);
  });

  it('confirming an already confirmed order is a no-op, not an error', async () => {
    const s = setup();
    const order = await s.placeOrder.execute({ customerId: 'c1', lines: [{ productId: 'p1', quantity: 1 }] });
    const placed = s.orders.outbox[0] as DomainEvent<OrderPlacedPayload>;
    await s.reserveStock.execute(placed);
    const reserved = s.publisher.published[0] as DomainEvent<StockReservedPayload>;
    await s.confirmOrder.execute(reserved);
    await expect(s.confirmOrder.execute(reserved)).resolves.toBeUndefined();
    expect(s.orders.outbox.filter((e) => e.eventType === 'OrderConfirmed')).toHaveLength(1);
    expect((await s.orders.findById(order.id))?.status).toBe('CONFIRMED');
  });

  it('PlaceOrder fails fast when a product does not exist', async () => {
    const s = setup();
    await expect(s.placeOrder.execute({ customerId: 'c1', lines: [{ productId: 'ghost', quantity: 1 }] })).rejects.toThrow(NotFoundError);
  });

  it('GetOrder hides other customers orders behind a 404', async () => {
    const s = setup();
    const order = await s.placeOrder.execute({ customerId: 'c1', lines: [{ productId: 'p1', quantity: 1 }] });
    const get = new GetOrder({ orders: s.orders });
    await expect(get.execute(order.id, { sub: 'c2', roles: ['customer'] })).rejects.toThrow(NotFoundError);
    await expect(get.execute(order.id, { sub: 'c1', roles: ['customer'] })).resolves.toMatchObject({ id: order.id });
    await expect(get.execute(order.id, { sub: 'someone', roles: ['admin'] })).resolves.toMatchObject({ id: order.id });
  });
});
