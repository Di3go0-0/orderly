/**
 * Consumidor de la cola inventory-queue. Cada mensaje es un evento OrderPlaced
 * que EventBridge depositó en SQS.
 */
import { fromSqsBody } from '@orderly/shared';
import { documentClient, DynamoIdempotencyStore, EventBridgePublisher, sqsBatchHandler, tableName } from '@orderly/shared/aws';
import { DynamoInventory } from '../infrastructure/dynamo-catalog-adapters.js';
import { ReserveStock } from '../application/reserve-stock.js';
import type { OrderPlacedPayload } from '../domain/events.js';

const client = documentClient();
const table = tableName();
const reserveStock = new ReserveStock({
  inventory: new DynamoInventory(client, table),
  publisher: new EventBridgePublisher(),
  idempotency: new DynamoIdempotencyStore(client, table),
});

export const handler = sqsBatchHandler(async (record) => {
  const event = fromSqsBody<OrderPlacedPayload>(record.body);
  if (event.eventType !== 'OrderPlaced') {
    throw new Error(`Unexpected event type ${event.eventType}`);
  }
  await reserveStock.execute(event);
});
