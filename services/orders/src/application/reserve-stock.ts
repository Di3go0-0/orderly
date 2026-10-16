/**
 * Paso de la SAGA que toca inventario. Reserva línea por línea; si una falla,
 * libera las anteriores (compensación local) y publica StockRejected.
 * Antes de nada reclama el eventId: SQS puede entregar el mismo mensaje dos veces.
 */
import { createEvent, logger, systemClock, ulidGenerator } from '@orderly/shared';
import type { Clock, DomainEvent, EventPublisher, IdGenerator } from '@orderly/shared';
import { ORDERS_SOURCE } from '../domain/events.js';
import type { OrderPlacedPayload, StockRejectedPayload, StockReservedPayload } from '../domain/events.js';
import type { Inventory } from '../domain/ports.js';

export interface IdempotencyPort {
  claim(consumer: string, eventId: string): Promise<boolean>;
}

export const RESERVE_STOCK_CONSUMER = 'reserve-stock';

export class ReserveStock {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(
    private readonly deps: {
      inventory: Inventory;
      publisher: EventPublisher;
      idempotency: IdempotencyPort;
      clock?: Clock;
      ids?: IdGenerator;
    },
  ) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(event: DomainEvent<OrderPlacedPayload>): Promise<'reserved' | 'rejected' | 'duplicate'> {
    const first = await this.deps.idempotency.claim(RESERVE_STOCK_CONSUMER, event.eventId);
    if (!first) {
      logger.info('duplicate OrderPlaced ignored', { eventId: event.eventId });
      return 'duplicate';
    }

    const { orderId, lines } = event.payload;
    const reserved: Array<{ productId: string; quantity: number }> = [];

    for (const line of lines) {
      const result = await this.deps.inventory.reserve(line.productId, line.quantity);
      if (result === 'reserved') {
        reserved.push(line);
        continue;
      }
      // Compensación: devolver lo que ya se había reservado para este pedido.
      for (const r of reserved) {
        await this.deps.inventory.release(r.productId, r.quantity);
      }
      const reason = result === 'missing' ? `Product ${line.productId} no longer exists` : `Insufficient stock for ${line.productId}`;
      await this.deps.publisher.publish([
        createEvent<StockRejectedPayload>(
          { eventType: 'StockRejected', source: ORDERS_SOURCE, aggregateId: orderId, payload: { orderId, reason } },
          { clock: this.clock, ids: this.ids },
        ),
      ]);
      logger.info('stock rejected', { orderId, reason });
      return 'rejected';
    }

    await this.deps.publisher.publish([
      createEvent<StockReservedPayload>(
        { eventType: 'StockReserved', source: ORDERS_SOURCE, aggregateId: orderId, payload: { orderId } },
        { clock: this.clock, ids: this.ids },
      ),
    ]);
    logger.info('stock reserved', { orderId, lines: lines.length });
    return 'reserved';
  }
}
