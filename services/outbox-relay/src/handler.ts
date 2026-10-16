/**
 * Relay del patrón Outbox.
 * DynamoDB Streams nos entrega cada fila nueva; el event source mapping ya filtra
 * (ver Terraform) para que solo lleguen INSERT con SK que empiece por OUTBOX#.
 * Aquí convertimos cada fila en un DomainEvent y lo publicamos en EventBridge.
 *
 * Si PutEvents falla, devolvemos la secuencia del registro fallido: Lambda
 * reintentará desde ahí (bisect + retries configurados en el mapping).
 */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent, Context } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { describeError, logger } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { EventBridgePublisher, OUTBOX_PREFIX, outboxItemToEvent } from '@orderly/shared/aws';
import type { OutboxItem } from '@orderly/shared/aws';

const publisher = new EventBridgePublisher();

export const handler = async (event: DynamoDBStreamEvent, context: Context): Promise<DynamoDBBatchResponse> => {
  logger.setContext({ requestId: context.awsRequestId });
  const failures: DynamoDBBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    const image = record.dynamodb?.NewImage;
    const sequence = record.dynamodb?.SequenceNumber ?? '';
    if (record.eventName !== 'INSERT' || !image) continue;

    try {
      const item = unmarshall(image as Record<string, AttributeValue>) as OutboxItem;
      if (!item.SK?.startsWith(OUTBOX_PREFIX)) continue; // defensa extra por si el filtro no está
      const domainEvent: DomainEvent = outboxItemToEvent(item);
      await publisher.publish([domainEvent]);
      logger.info('relayed', { eventType: domainEvent.eventType, aggregateId: domainEvent.aggregateId, eventId: domainEvent.eventId });
    } catch (err) {
      logger.error('relay failed', { sequence, ...describeError(err) });
      failures.push({ itemIdentifier: sequence });
      break; // los streams son ordenados: a partir del fallo, todo se reintenta
    }
  }

  logger.clearContext();
  return { batchItemFailures: failures };
};
