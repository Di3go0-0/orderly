/**
 * Consumidor de index-queue. Esta es la Lambda que se despliega como IMAGEN DOCKER
 * (ver services/search/Dockerfile): mismo código, otro empaquetado.
 */
import { fromSqsBody, logger } from '@orderly/shared';
import { sqsBatchHandler } from '@orderly/shared/aws';
import { ProjectProductEvent } from '../application/use-cases.js';
import { productIndexFromEnv } from '../infrastructure/index-factory.js';

const index = productIndexFromEnv();
const project = index ? new ProjectProductEvent(index) : null;

export const handler = sqsBatchHandler(async (record) => {
  const event = fromSqsBody(record.body);
  if (!project) {
    // OpenSearch apagado: no fallamos (iría a la DLQ). `pnpm reindex` reconstruye el índice después.
    logger.warn('OPENSEARCH_URL not set; skipping event', { eventType: event.eventType, aggregateId: event.aggregateId });
    return;
  }
  await project.execute(event);
  logger.info('projected', { eventType: event.eventType, aggregateId: event.aggregateId });
});
