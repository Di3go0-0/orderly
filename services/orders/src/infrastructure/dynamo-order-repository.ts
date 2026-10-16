import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConflictError, NotFoundError } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import { isConditionalCheckFailed, keys, outboxItem } from '@orderly/shared/aws';
import { Order } from '../domain/order.js';
import type { OrderProps } from '../domain/order.js';
import type { OrderRepository } from '../domain/ports.js';

type OrderItem = OrderProps & { PK: string; SK: string; GSI1PK: string; GSI1SK: string; type: 'Order' };

export class DynamoOrderRepository implements OrderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async findById(id: string): Promise<Order | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.table, Key: keys.order(id) }));
    return res.Item ? Order.rehydrate(toProps(res.Item as OrderItem)) : null;
  }

  /** Usa el GSI1: todos los pedidos de un cliente, del más reciente al más antiguo. */
  async listByCustomer(customerId: string, limit: number): Promise<Order[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${customerId}`, ':prefix': 'ORDER#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => Order.rehydrate(toProps(i as OrderItem)));
  }

  async create(order: Order, events: DomainEvent[]): Promise<void> {
    const item = toItem(order.snapshot());
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.table, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
            ...events.map((e) => ({ Put: { TableName: this.table, Item: outboxItem(item.PK, e) } })),
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new ConflictError(`Order ${order.id} already exists`);
      throw err;
    }
  }

  async update(order: Order, events: DomainEvent[]): Promise<void> {
    const item = toItem(order.snapshot());
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.table, Item: item, ConditionExpression: 'attribute_exists(PK)' } },
            ...events.map((e) => ({ Put: { TableName: this.table, Item: outboxItem(item.PK, e) } })),
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new NotFoundError('Order', order.id);
      throw err;
    }
  }
}

function toItem(o: OrderProps): OrderItem {
  return {
    ...keys.order(o.id),
    GSI1PK: `USER#${o.customerId}`,
    GSI1SK: `ORDER#${o.createdAt}#${o.id}`,
    type: 'Order',
    ...o,
  };
}

function toProps(item: OrderItem): OrderProps {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, type: _t, ...props } = item;
  return props;
}
