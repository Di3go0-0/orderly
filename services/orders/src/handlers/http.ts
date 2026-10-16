import { z } from 'zod';
import { parse, requireRole } from '@orderly/shared';
import { created, documentClient, ok, router, tableName } from '@orderly/shared/aws';
import { DynamoOrderRepository } from '../infrastructure/dynamo-order-repository.js';
import { DynamoProductLookup } from '../infrastructure/dynamo-catalog-adapters.js';
import { PlaceOrder } from '../application/place-order.js';
import { GetOrder, ListMyOrders } from '../application/order-lifecycle.js';

const client = documentClient();
const table = tableName();
const orders = new DynamoOrderRepository(client, table);
const placeOrder = new PlaceOrder({ orders, products: new DynamoProductLookup(client, table) });
const getOrder = new GetOrder({ orders });
const listMyOrders = new ListMyOrders({ orders });

const placeOrderBody = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(20),
});

const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const limitQuery = z.coerce.number().int().min(1).max(50).default(20);

export const handler = router({
  'POST /orders': async (req) => {
    requireRole(req.principal, 'customer', 'admin');
    const body = parse(placeOrderBody, req.body);
    const order = await placeOrder.execute({
      customerId: req.principal.sub,
      customerEmail: req.principal.email,
      lines: body.lines,
    });
    return created(order);
  },

  'GET /orders/{id}': async (req) => {
    requireRole(req.principal, 'customer', 'admin');
    const id = parse(idParam, req.pathParams.id);
    return ok(await getOrder.execute(id, req.principal));
  },

  'GET /me/orders': async (req) => {
    requireRole(req.principal, 'customer', 'admin');
    const limit = parse(limitQuery, req.query.limit);
    return ok({ items: await listMyOrders.execute(req.principal, limit) });
  },
});
