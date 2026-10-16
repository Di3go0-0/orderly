/**
 * Handler HTTP del catálogo. Una Lambda, cuatro rutas.
 * Solo traduce: evento de API Gateway -> caso de uso -> respuesta.
 */
import { z } from 'zod';
import { parse, requireRole } from '@orderly/shared';
import { created, documentClient, noContent, ok, router, tableName } from '@orderly/shared/aws';
import { DynamoProductRepository } from '../infrastructure/dynamo-product-repository.js';
import { CreateProduct, DeleteProduct, GetProduct, UpdateProduct } from '../application/use-cases.js';

// Se construye una vez por contenedor (cold start) y se reutiliza entre invocaciones.
const repo = new DynamoProductRepository(documentClient(), tableName());
const createProduct = new CreateProduct({ repo });
const updateProduct = new UpdateProduct({ repo });
const deleteProduct = new DeleteProduct({ repo });
const getProduct = new GetProduct({ repo });

const productBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  priceCents: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
});

const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const handler = router({
  'POST /products': async (req) => {
    requireRole(req.principal, 'admin');
    const input = parse(productBody, req.body);
    return created(await createProduct.execute(input));
  },

  'GET /products/{id}': async (req) => {
    requireRole(req.principal, 'admin', 'customer');
    const id = parse(idParam, req.pathParams.id);
    return ok(await getProduct.execute(id));
  },

  'PUT /products/{id}': async (req) => {
    requireRole(req.principal, 'admin');
    const id = parse(idParam, req.pathParams.id);
    const changes = parse(productBody.partial(), req.body);
    return ok(await updateProduct.execute(id, changes));
  },

  'DELETE /products/{id}': async (req) => {
    requireRole(req.principal, 'admin');
    const id = parse(idParam, req.pathParams.id);
    await deleteProduct.execute(id);
    return noContent();
  },
});
