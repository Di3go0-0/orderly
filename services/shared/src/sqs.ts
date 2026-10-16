/**
 * Envoltorio para Lambdas que consumen SQS en lote.
 * Con `ReportBatchItemFailures` activado en el event source mapping, devolver los
 * messageId fallidos hace que SQS reintente SOLO esos, no todo el lote.
 * Tras `maxReceiveCount` fallos el mensaje pasa a la DLQ.
 */
import type { SQSBatchResponse, SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { logger, describeError } from './logger.js';

export type RecordProcessor = (record: SQSRecord) => Promise<void>;

export function sqsBatchHandler(process: RecordProcessor) {
  return async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
    logger.setContext({ requestId: context.awsRequestId });
    const failures: SQSBatchResponse['batchItemFailures'] = [];
    for (const record of event.Records) {
      try {
        await process(record);
      } catch (err) {
        logger.error('sqs record failed', { messageId: record.messageId, ...describeError(err) });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    logger.info('sqs batch done', { received: event.Records.length, failed: failures.length });
    logger.clearContext();
    return { batchItemFailures: failures };
  };
}
