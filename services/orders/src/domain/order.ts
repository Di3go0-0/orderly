/**
 * Agregado Order con su máquina de estados:
 *
 *   PENDING --(StockReserved)--> CONFIRMED
 *   PENDING --(StockRejected)--> REJECTED
 *
 * Cualquier otra transición es una violación de invariante. Eso hace a los
 * consumidores naturalmente idempotentes: confirmar dos veces falla la segunda.
 */
import { InvariantError } from '@orderly/shared';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderProps {
  id: string;
  customerId: string;
  customerEmail?: string;
  lines: OrderLine[];
  status: OrderStatus;
  totalCents: number;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_LINES = 20;
const MAX_QTY = 100;

export class Order {
  private constructor(private props: OrderProps) {}

  static place(input: { id: string; customerId: string; customerEmail?: string; lines: OrderLine[] }, now: Date): Order {
    if (input.lines.length === 0) throw new InvariantError('An order needs at least one line');
    if (input.lines.length > MAX_LINES) throw new InvariantError(`At most ${MAX_LINES} lines per order`);
    const seen = new Set<string>();
    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > MAX_QTY) {
        throw new InvariantError(`Invalid quantity for product ${line.productId}`);
      }
      if (seen.has(line.productId)) throw new InvariantError(`Duplicate product ${line.productId} in order`);
      seen.add(line.productId);
    }
    const ts = now.toISOString();
    const totalCents = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
    return new Order({
      id: input.id,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      lines: input.lines.map((l) => ({ ...l })),
      status: 'PENDING',
      totalCents,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  static rehydrate(props: OrderProps): Order {
    return new Order({ ...props, lines: props.lines.map((l) => ({ ...l })) });
  }

  confirm(now: Date): void {
    this.transition('CONFIRMED', now);
  }

  reject(reason: string, now: Date): void {
    this.transition('REJECTED', now);
    this.props.rejectionReason = reason;
  }

  private transition(to: OrderStatus, now: Date): void {
    if (this.props.status !== 'PENDING') {
      throw new InvariantError(`Order ${this.props.id} is ${this.props.status}; cannot move to ${to}`);
    }
    this.props.status = to;
    this.props.updatedAt = now.toISOString();
  }

  get id(): string {
    return this.props.id;
  }
  get customerId(): string {
    return this.props.customerId;
  }
  get status(): OrderStatus {
    return this.props.status;
  }

  snapshot(): OrderProps {
    return { ...this.props, lines: this.props.lines.map((l) => ({ ...l })) };
  }
}
