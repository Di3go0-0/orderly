/**
 * Adaptador OpenSearch del puerto ProductIndex.
 *
 * Local:  OPENSEARCH_URL=http://localhost:9200  OPENSEARCH_AUTH=none
 * AWS:    OPENSEARCH_URL=https://<dominio>       OPENSEARCH_AUTH=sigv4  (firma con el rol de la Lambda)
 */
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { logger } from '@orderly/shared';
import type { ProductDocument, ProductIndex, SearchQuery, SearchResult } from '../domain/product-index.js';

export const PRODUCTS_INDEX = 'products';

// Mapping explícito: text para buscar, keyword para filtrar/ordenar, integer para rangos.
const INDEX_BODY = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    properties: {
      id: { type: 'keyword' },
      name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      description: { type: 'text' },
      priceCents: { type: 'integer' },
      stock: { type: 'integer' },
      tags: { type: 'keyword' },
      updatedAt: { type: 'date' },
    },
  },
} as const;

export function createOpenSearchClient(url: string, auth: 'none' | 'sigv4', region?: string): Client {
  if (auth === 'sigv4') {
    return new Client({
      ...AwsSigv4Signer({
        region: region ?? process.env.AWS_REGION ?? 'us-east-1',
        service: 'es',
        getCredentials: () => defaultProvider()(),
      }),
      node: url,
    });
  }
  return new Client({ node: url });
}

export class OpenSearchProductIndex implements ProductIndex {
  private ready = false;

  constructor(
    private readonly client: Client,
    private readonly indexName: string = PRODUCTS_INDEX,
  ) {}

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists.body) {
      logger.info('creating index', { index: this.indexName });
      await this.client.indices.create({ index: this.indexName, body: INDEX_BODY });
    }
    this.ready = true;
  }

  async upsert(doc: ProductDocument): Promise<void> {
    await this.ensureReady();
    await this.client.index({ index: this.indexName, id: doc.id, body: doc, refresh: 'wait_for' });
  }

  async remove(id: string): Promise<void> {
    await this.ensureReady();
    await this.client.delete({ index: this.indexName, id, refresh: 'wait_for' }).catch((err: { statusCode?: number }) => {
      if (err.statusCode !== 404) throw err; // borrar algo que no está es un éxito idempotente
    });
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    await this.ensureReady();
    const must = query.text.trim()
      ? [{ multi_match: { query: query.text, fields: ['name^3', 'tags^2', 'description'], fuzziness: 'AUTO' } }]
      : [{ match_all: {} }];
    const filter = query.inStockOnly ? [{ range: { stock: { gt: 0 } } }] : [];
    const res = await this.client.search({
      index: this.indexName,
      body: {
        size: query.limit,
        query: { bool: { must, filter } },
        sort: query.text.trim() ? ['_score', { updatedAt: 'desc' }] : [{ updatedAt: 'desc' }],
      },
    });
    const hits = res.body.hits;
    const total = typeof hits.total === 'number' ? hits.total : (hits.total?.value ?? 0);
    return { items: hits.hits.map((h) => h._source as ProductDocument), total };
  }
}
