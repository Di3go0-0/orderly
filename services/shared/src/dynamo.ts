/**
 * Acceso a DynamoDB y convenciones de la tabla única "orderly".
 *
 *   PK                      SK                 GSI1PK          GSI1SK
 *   PRODUCT#<id>            META                                              producto
 *   ORDER#<id>              META               USER#<sub>      ORDER#<ts>     pedido (líneas embebidas)
 *   <PK del agregado>       OUTBOX#<eventId>                                  evento pendiente de publicar
 *   IDEMP#<consumer>#<evt>  META                                              marca "ya procesado"
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DomainEvent } from './events.js';
import { requireEnv } from './env.js';

let cached: DynamoDBDocumentClient | undefined;

export function documentClient(): DynamoDBDocumentClient {
  if (cached) return cached;
  const endpoint = process.env.DYNAMODB_ENDPOINT; // solo en local (DynamoDB Local)
  const base = new DynamoDBClient(endpoint ? { endpoint } : {});
  cached = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export function tableName(): string {
  return requireEnv('TABLE_NAME');
}

export const keys = {
  product: (id: string) => ({ PK: `PRODUCT#${id}`, SK: 'META' }),
  order: (id: string) => ({ PK: `ORDER#${id}`, SK: 'META' }),
  outbox: (aggregatePK: string, eventId: string) => ({ PK: aggregatePK, SK: `OUTBOX#${eventId}` }),
  idempotency: (consumer: string, eventId: string) => ({ PK: `IDEMP#${consumer}#${eventId}`, SK: 'META' }),
};

export const OUTBOX_PREFIX = 'OUTBOX#';
const OUTBOX_TTL_SECONDS = 24 * 60 * 60;

export interface OutboxItem {
  PK: string;
  SK: string;
  type: 'Outbox';
  eventId: string;
  eventType: string;
  source: string;
  aggregateId: string;
  occurredAt: string;
  payload: unknown;
  ttl: number;
}

/** Construye la fila OUTBOX que se escribe en la misma transacción que el agregado. */
export function outboxItem(aggregatePK: string, event: DomainEvent): OutboxItem {
  return {
    ...keys.outbox(aggregatePK, event.eventId),
    type: 'Outbox',
    eventId: event.eventId,
    eventType: event.eventType,
    source: event.source,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt,
    payload: event.payload,
    ttl: Math.floor(Date.now() / 1000) + OUTBOX_TTL_SECONDS,
  };
}

export function outboxItemToEvent(item: OutboxItem): DomainEvent {
  return {
    eventId: item.eventId,
    eventType: item.eventType,
    source: item.source,
    aggregateId: item.aggregateId,
    occurredAt: item.occurredAt,
    payload: item.payload,
  };
}

export function isConditionalCheckFailed(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
  if (e.name === 'ConditionalCheckFailedException') return true;
  // TransactWriteItems envuelve la razón en CancellationReasons
  return e.name === 'TransactionCanceledException' &&
    (e.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed');
}
