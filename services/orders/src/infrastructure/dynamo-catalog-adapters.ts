/**
 * Orders necesita dos cosas del catálogo: leer precios y mover stock.
 * Atajo consciente: ambos contextos comparten la tabla, así que leemos/escribimos
 * los items PRODUCT# directamente. En un sistema grande esto sería una llamada
 * al contexto Catalog; aquí mantenemos la frontera en el código (puertos) y no en la red.
 */
import { BatchGetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { isConditionalCheckFailed, keys } from '@orderly/shared/aws';
import type { Inventory, ProductLookup, ReserveResult } from '../domain/ports.js';

export class DynamoProductLookup implements ProductLookup {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async findMany(ids: string[]): Promise<Array<{ id: string; name: string; priceCents: number }>> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const res = await this.client.send(
      new BatchGetCommand({
        RequestItems: {
          [this.table]: {
            Keys: unique.map((id) => keys.product(id)),
            ProjectionExpression: 'id, #n, priceCents',
            ExpressionAttributeNames: { '#n': 'name' },
          },
        },
      }),
    );
    const items = (res.Responses?.[this.table] ?? []) as Array<{ id: string; name: string; priceCents: number }>;
    return items;
  }
}

export class DynamoInventory implements Inventory {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  /** Resta stock solo si alcanza: la condición la evalúa DynamoDB de forma atómica. */
  async reserve(productId: string, quantity: number): Promise<ReserveResult> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.product(productId),
          UpdateExpression: 'SET stock = stock - :q, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND stock >= :q',
          ExpressionAttributeValues: { ':q': quantity, ':now': new Date().toISOString() },
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      );
      return 'reserved';
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err;
      const old = (err as { Item?: Record<string, unknown> }).Item;
      return old ? 'insufficient' : 'missing';
    }
  }

  async release(productId: string, quantity: number): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: keys.product(productId),
        UpdateExpression: 'SET stock = stock + :q, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':q': quantity, ':now': new Date().toISOString() },
      }),
    );
  }
}
