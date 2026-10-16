/**
 * Últimos pasos de la SAGA: confirmar o rechazar el pedido según el resultado del inventario.
 * Ambos escriben el nuevo estado + el evento final por el outbox.
 */
import { createEvent, InvariantError, logger, NotFoundError, systemClock, ulidGenerator } from '@orderly/shared';
import type { Clock, DomainEvent, IdGenerator, Principal } from '@orderly/shared';
import { hasRole } from '@orderly/shared';
import type { OrderProps } from '../domain/order.js';
import { ORDERS_SOURCE } from '../domain/events.js';
import type { OrderConfirmedPayload, OrderRejectedPayload, StockRejectedPayload, StockReservedPayload } from '../domain/events.js';
import type { OrderRepository } from '../domain/ports.js';

interface Deps {
  orders: OrderRepository;
  clock?: Clock;
  ids?: IdGenerator;
}

export class ConfirmOrder {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(private readonly deps: Deps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(event: DomainEvent<StockReservedPayload>): Promise<void> {
    const order = await this.deps.orders.findById(event.payload.orderId);
    if (!order) throw new NotFoundError('Order', event.payload.orderId);
    try {
      order.confirm(this.clock.now());
    } catch (err) {
      // Ya estaba confirmado/rechazado: reentrega del mismo evento. No es un error.
      if (err instanceof InvariantError) {
        logger.warn('confirm skipped', { orderId: order.id, status: order.status });
        return;
      }
      throw err;
    }
    const s = order.snapshot();
    const confirmed = createEvent<OrderConfirmedPayload>(
      {
        eventType: 'OrderConfirmed',
        source: ORDERS_SOURCE,
        aggregateId: order.id,
        payload: { orderId: order.id, customerId: s.customerId, customerEmail: s.customerEmail, totalCents: s.totalCents },
      },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.orders.update(order, [confirmed]);
  }
}

export class RejectOrder {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(private readonly deps: Deps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(event: DomainEvent<StockRejectedPayload>): Promise<void> {
    const order = await this.deps.orders.findById(event.payload.orderId);
    if (!order) throw new NotFoundError('Order', event.payload.orderId);
    try {
      order.reject(event.payload.reason, this.clock.now());
    } catch (err) {
      if (err instanceof InvariantError) {
        logger.warn('reject skipped', { orderId: order.id, status: order.status });
        return;
      }
      throw err;
    }
    const rejected = createEvent<OrderRejectedPayload>(
      {
        eventType: 'OrderRejected',
        source: ORDERS_SOURCE,
        aggregateId: order.id,
        payload: { orderId: order.id, customerId: order.customerId, reason: event.payload.reason },
      },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.orders.update(order, [rejected]);
  }
}

export class GetOrder {
  constructor(private readonly deps: { orders: OrderRepository }) {}

  /** Un customer solo ve sus pedidos. Devolvemos 404 (no 403) para no revelar que el id existe. */
  async execute(id: string, principal: Principal): Promise<OrderProps> {
    const order = await this.deps.orders.findById(id);
    if (!order || (!hasRole(principal, 'admin') && order.customerId !== principal.sub)) {
      throw new NotFoundError('Order', id);
    }
    return order.snapshot();
  }
}

export class ListMyOrders {
  constructor(private readonly deps: { orders: OrderRepository }) {}

  async execute(principal: Principal, limit = 20): Promise<OrderProps[]> {
    const orders = await this.deps.orders.listByCustomer(principal.sub, limit);
    return orders.map((o) => o.snapshot());
  }
}
