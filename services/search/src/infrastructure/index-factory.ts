import { optionalEnv } from '@orderly/shared';
import type { ProductIndex } from '../domain/product-index.js';
import { createOpenSearchClient, OpenSearchProductIndex } from './opensearch-product-index.js';

/** Devuelve el índice o null si OpenSearch está apagado (enable_opensearch = false en Terraform). */
export function productIndexFromEnv(): ProductIndex | null {
  const url = optionalEnv('OPENSEARCH_URL');
  if (!url) return null;
  const auth = optionalEnv('OPENSEARCH_AUTH', 'sigv4') === 'none' ? 'none' : 'sigv4';
  return new OpenSearchProductIndex(createOpenSearchClient(url, auth));
}
