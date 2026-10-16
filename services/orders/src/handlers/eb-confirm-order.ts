/** Target directo de la regla StockReserved en EventBridge (sin cola intermedia). */
import type { EventBridgeHandler } from 'aws-lambda';
import { fromEventBridge, logger } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { documentClient, tableName } from '@orderly/shared/aws';
import { DynamoOrderRepository } from '../infrastructure/dynamo-order-repository.js';
import { ConfirmOrder } from '../application/order-lifecycle.js';
import type { StockReservedPayload } from '../domain/events.js';

const confirmOrder = new ConfirmOrder({ orders: new DynamoOrderRepository(documentClient(), tableName()) });

export const handler: EventBridgeHandler<'StockReserved', DomainEvent<StockReservedPayload>, void> = async (event) => {
  const domainEvent = fromEventBridge<StockReservedPayload>(event);
  logger.info('confirming order', { orderId: domainEvent.payload.orderId, eventId: domainEvent.eventId });
  await confirmOrder.execute(domainEvent);
};
