/**
 * Reconstruye el índice de OpenSearch leyendo todos los PRODUCT# de DynamoDB.
 * Útil tras encender OpenSearch en AWS (los eventos anteriores se descartaron)
 * o para poblar el entorno local.
 *
 *   TABLE_NAME=orderly-dev OPENSEARCH_URL=https://... OPENSEARCH_AUTH=sigv4 pnpm reindex
 */
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, tableName } from '../services/shared/src/aws.js';
import { productIndexFromEnv } from '../services/search/src/infrastructure/index-factory.js';
import type { ProductDocument } from '../services/search/src/domain/product-index.js';

async function main(): Promise<void> {
  const index = productIndexFromEnv();
  if (!index) throw new Error('OPENSEARCH_URL is required');
  await index.ensureReady();

  const client = documentClient();
  let lastKey: Record<string, unknown> | undefined;
  let count = 0;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName(),
        FilterExpression: '#t = :product',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':product': 'Product' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const p = item as ProductDocument;
      await index.upsert({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, stock: p.stock, tags: p.tags, updatedAt: p.updatedAt });
      count += 1;
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log(`Reindexados ${count} productos`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
