/**
 * Adaptador de salida: publica DomainEvents en el bus de EventBridge.
 * detail-type = eventType, source = "orderly.<contexto>", detail = el evento completo.
 */
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import type { DomainEvent, EventPublisher } from './events.js';
import { requireEnv } from './env.js';
import { logger } from './logger.js';

const MAX_ENTRIES_PER_CALL = 10; // límite de la API PutEvents

export class EventBridgePublisher implements EventPublisher {
  constructor(
    private readonly client: EventBridgeClient = new EventBridgeClient({}),
    private readonly busName: string = requireEnv('EVENT_BUS_NAME'),
  ) {}

  async publish(events: DomainEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += MAX_ENTRIES_PER_CALL) {
      const chunk = events.slice(i, i + MAX_ENTRIES_PER_CALL);
      const Entries: PutEventsRequestEntry[] = chunk.map((e) => ({
        EventBusName: this.busName,
        Source: `orderly.${e.source}`,
        DetailType: e.eventType,
        Detail: JSON.stringify(e),
        Time: new Date(e.occurredAt),
      }));
      const res = await this.client.send(new PutEventsCommand({ Entries }));
      if (res.FailedEntryCount && res.FailedEntryCount > 0) {
        logger.error('eventbridge rejected entries', { failed: res.FailedEntryCount, entries: res.Entries });
        throw new Error(`EventBridge rejected ${res.FailedEntryCount} entries`);
      }
      logger.debug('events published', { count: chunk.length, types: chunk.map((e) => e.eventType) });
    }
  }
}
