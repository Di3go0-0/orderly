/**
 * Sobre (envelope) común a todos los eventos de dominio.
 * Viaja igual por el outbox, por EventBridge y dentro de los mensajes SQS.
 */
import type { Clock, IdGenerator } from './ports.js';
import { systemClock, ulidGenerator } from './ports.js';
import { ValidationError } from './errors.js';

export interface DomainEvent<T = unknown> {
  /** Único por evento; es la clave de idempotencia de los consumidores. */
  eventId: string;
  /** Nombre en PascalCase: OrderPlaced, ProductCreated... Es el `detail-type` en EventBridge. */
  eventType: string;
  /** Contexto que lo emitió: catalog | orders | search. Es el `source` ("orderly.catalog"). */
  source: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
}

/** Puerto de salida: quien lo implemente decide si va a EventBridge, a memoria o a un outbox. */
export interface EventPublisher {
  publish(events: DomainEvent[]): Promise<void>;
}

export function createEvent<T>(
  args: { eventType: string; source: string; aggregateId: string; payload: T },
  deps: { clock?: Clock; ids?: IdGenerator } = {},
): DomainEvent<T> {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? ulidGenerator;
  return {
    eventId: ids.next(),
    eventType: args.eventType,
    source: args.source,
    aggregateId: args.aggregateId,
    occurredAt: clock.now().toISOString(),
    payload: args.payload,
  };
}

/** Forma con la que EventBridge entrega un evento a un target (Lambda o cuerpo de SQS). */
export interface EventBridgeEnvelope<T = unknown> {
  'detail-type': string;
  source: string;
  detail: DomainEvent<T>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

export function isDomainEvent(x: unknown): x is DomainEvent {
  return (
    isRecord(x) &&
    typeof x.eventId === 'string' &&
    typeof x.eventType === 'string' &&
    typeof x.aggregateId === 'string' &&
    typeof x.occurredAt === 'string' &&
    'payload' in x
  );
}

/** Extrae el DomainEvent de un evento de EventBridge (ya parseado). */
export function fromEventBridge<T = unknown>(raw: unknown): DomainEvent<T> {
  if (isRecord(raw) && isDomainEvent(raw.detail)) {
    return raw.detail as DomainEvent<T>;
  }
  throw new ValidationError('Not an EventBridge envelope with a DomainEvent in detail');
}

/** Extrae el DomainEvent del body de un mensaje SQS que llegó vía EventBridge. */
export function fromSqsBody<T = unknown>(body: string): DomainEvent<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ValidationError('SQS body is not JSON');
  }
  return fromEventBridge<T>(parsed);
}

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  async publish(events: DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }
}
