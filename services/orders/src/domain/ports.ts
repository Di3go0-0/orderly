import type { DomainEvent } from '@orderly/shared';
import type { Order } from './order.js';

export interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  listByCustomer(customerId: string, limit: number): Promise<Order[]>;
  create(order: Order, events: DomainEvent[]): Promise<void>;
  update(order: Order, events: DomainEvent[]): Promise<void>;
}

/** Lectura mínima del catálogo que Orders necesita para fijar precios al momento del pedido. */
export interface ProductLookup {
  findMany(ids: string[]): Promise<Array<{ id: string; name: string; priceCents: number }>>;
}

export type ReserveResult = 'reserved' | 'insufficient' | 'missing';

/** Reserva y liberación de stock. La liberación es la compensación de la SAGA. */
export interface Inventory {
  reserve(productId: string, quantity: number): Promise<ReserveResult>;
  release(productId: string, quantity: number): Promise<void>;
}
