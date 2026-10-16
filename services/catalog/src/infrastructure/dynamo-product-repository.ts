/**
 * Adaptador DynamoDB del puerto ProductRepository.
 * Cada escritura es un TransactWrite: el producto + una fila OUTBOX por evento.
 * O se guardan todos o ninguno: así nunca hay evento sin dato ni dato sin evento.
 */
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConflictError, NotFoundError } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { isConditionalCheckFailed, keys, outboxItem } from '@orderly/shared/aws';
import { Product } from '../domain/product.js';
import type { ProductProps } from '../domain/product.js';
import type { ProductRepository } from '../domain/product-repository.js';

type ProductItem = ProductProps & { PK: string; SK: string; type: 'Product' };

export class DynamoProductRepository implements ProductRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async findById(id: string): Promise<Product | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.table, Key: keys.product(id) }));
    if (!res.Item) return null;
    return Product.rehydrate(toProps(res.Item as ProductItem));
  }

  async create(product: Product, events: DomainEvent[]): Promise<void> {
    const item = toItem(product.snapshot());
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.table, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
            ...this.outboxPuts(item.PK, events),
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new ConflictError(`Product ${product.id} already exists`);
      throw err;
    }
  }

  async update(product: Product, events: DomainEvent[]): Promise<void> {
    const item = toItem(product.snapshot());
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.table, Item: item, ConditionExpression: 'attribute_exists(PK)' } },
            ...this.outboxPuts(item.PK, events),
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new NotFoundError('Product', product.id);
      throw err;
    }
  }

  async delete(id: string, events: DomainEvent[]): Promise<void> {
    const key = keys.product(id);
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: this.table, Key: key, ConditionExpression: 'attribute_exists(PK)' } },
            ...this.outboxPuts(key.PK, events),
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new NotFoundError('Product', id);
      throw err;
    }
  }

  private outboxPuts(aggregatePK: string, events: DomainEvent[]) {
    return events.map((e) => ({ Put: { TableName: this.table, Item: outboxItem(aggregatePK, e) } }));
  }
}

function toItem(p: ProductProps): ProductItem {
  return { ...keys.product(p.id), type: 'Product', ...p };
}

function toProps(item: ProductItem): ProductProps {
  const { PK: _pk, SK: _sk, type: _t, ...props } = item;
  return props;
}
