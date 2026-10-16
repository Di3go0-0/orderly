import { z } from 'zod';
import { parse, requireRole, UnavailableError } from '@orderly/shared';
import { ok, router } from '@orderly/shared/aws';
import { SearchProducts } from '../application/use-cases.js';
import { productIndexFromEnv } from '../infrastructure/index-factory.js';

const index = productIndexFromEnv();
const searchProducts = index ? new SearchProducts(index) : null;

const searchQuery = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  inStock: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const handler = router({
  'GET /products/search': async (req) => {
    requireRole(req.principal, 'admin', 'customer');
    if (!searchProducts) throw new UnavailableError('Search is disabled in this environment');
    const { q, limit, inStock } = parse(searchQuery, req.query);
    return ok(await searchProducts.execute({ text: q, limit, inStockOnly: inStock }));
  },
});
