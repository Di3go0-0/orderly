import { createEvent, NotFoundError, systemClock, ulidGenerator } from '@orderly/shared';
import type { Clock, IdGenerator } from '@orderly/shared';
import { Order } from '../domain/order.js';
import type { OrderLine, OrderProps } from '../domain/order.js';
import { ORDERS_SOURCE } from '../domain/events.js';
import type { OrderPlacedPayload } from '../domain/events.js';
import type { OrderRepository, ProductLookup } from '../domain/ports.js';

export interface PlaceOrderInput {
  customerId: string;
  customerEmail?: string;
  lines: Array<{ productId: string; quantity: number }>;
}

export class PlaceOrder {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(
    private readonly deps: { orders: OrderRepository; products: ProductLookup; clock?: Clock; ids?: IdGenerator },
  ) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(input: PlaceOrderInput): Promise<OrderProps> {
    const ids = input.lines.map((l) => l.productId);
    const products = await this.deps.products.findMany(ids);
    const byId = new Map(products.map((p) => [p.id, p]));

    // El precio se congela en el pedido: si el catálogo cambia después, el pedido no.
    const lines: OrderLine[] = input.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p) throw new NotFoundError('Product', l.productId);
      return { productId: p.id, name: p.name, quantity: l.quantity, unitPriceCents: p.priceCents };
    });

    const order = Order.place(
      { id: this.ids.next(), customerId: input.customerId, customerEmail: input.customerEmail, lines },
      this.clock.now(),
    );
    const snapshot = order.snapshot();
    const event = createEvent<OrderPlacedPayload>(
      {
        eventType: 'OrderPlaced',
        source: ORDERS_SOURCE,
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          customerId: order.customerId,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          totalCents: snapshot.totalCents,
        },
      },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.orders.create(order, [event]);
    return snapshot;
  }
}
