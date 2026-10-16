/**
 * SQS entrega "al menos una vez". Un consumidor puede recibir el mismo mensaje dos veces
 * (reintentos, timeouts). Antes de hacer un efecto no repetible (descontar stock) reclamamos
 * el eventId con una escritura condicional: solo el primero gana.
 */
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { isConditionalCheckFailed, keys } from './dynamo.js';

export interface IdempotencyStore {
  /** true si es la primera vez que se ve este eventId para este consumidor. */
  claim(consumer: string, eventId: string): Promise<boolean>;
}

const TTL_SECONDS = 7 * 24 * 60 * 60;

export class DynamoIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async claim(consumer: string, eventId: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            ...keys.idempotency(consumer, eventId),
            type: 'Idempotency',
            claimedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();
  async claim(consumer: string, eventId: string): Promise<boolean> {
    const key = `${consumer}#${eventId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
