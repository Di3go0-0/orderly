import type { DomainEvent } from '@orderly/shared';
import type { Product } from './product.js';

/**
 * Puerto de persistencia. Recibe los eventos junto al agregado para que el adaptador
 * los guarde en la MISMA transacción (patrón Outbox).
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  /** Falla con ConflictError si el id ya existe. */
  create(product: Product, events: DomainEvent[]): Promise<void>;
  /** Falla con NotFoundError si el producto no existe. */
  update(product: Product, events: DomainEvent[]): Promise<void>;
  delete(id: string, events: DomainEvent[]): Promise<void>;
}
