/** Target directo de la regla StockRejected: la compensación de la SAGA. */
import type { EventBridgeHandler } from 'aws-lambda';
import { fromEventBridge, logger } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { documentClient, tableName } from '@orderly/shared/aws';
import { DynamoOrderRepository } from '../infrastructure/dynamo-order-repository.js';
import { RejectOrder } from '../application/order-lifecycle.js';
import type { StockRejectedPayload } from '../domain/events.js';

const rejectOrder = new RejectOrder({ orders: new DynamoOrderRepository(documentClient(), tableName()) });

export const handler: EventBridgeHandler<'StockRejected', DomainEvent<StockRejectedPayload>, void> = async (event) => {
  const domainEvent = fromEventBridge<StockRejectedPayload>(event);
  logger.info('rejecting order', { orderId: domainEvent.payload.orderId, reason: domainEvent.payload.reason });
  await rejectOrder.execute(domainEvent);
};
