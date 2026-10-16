import { describe, expect, it } from 'vitest';
import { createEvent, fromEventBridge, fromSqsBody } from './events.js';
import { FixedClock, SequenceIds } from './ports.js';
import { ValidationError } from './errors.js';

describe('events', () => {
  const ev = createEvent(
    { eventType: 'OrderPlaced', source: 'orders', aggregateId: 'o1', payload: { orderId: 'o1' } },
    { clock: new FixedClock(new Date('2026-01-01T00:00:00Z')), ids: new SequenceIds('evt-') },
  );

  it('createEvent fills id and timestamp from the ports', () => {
    expect(ev).toEqual({
      eventId: 'evt-1',
      eventType: 'OrderPlaced',
      source: 'orders',
      aggregateId: 'o1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { orderId: 'o1' },
    });
  });

  it('round-trips through an EventBridge envelope and an SQS body', () => {
    const envelope = { 'detail-type': ev.eventType, source: `orderly.${ev.source}`, detail: ev };
    expect(fromEventBridge(envelope)).toEqual(ev);
    expect(fromSqsBody(JSON.stringify(envelope))).toEqual(ev);
  });

  it('rejects malformed input', () => {
    expect(() => fromSqsBody('not json')).toThrow(ValidationError);
    expect(() => fromEventBridge({ detail: { nope: true } })).toThrow(ValidationError);
  });
});
