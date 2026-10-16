/**
 * Crea la tabla "orderly" en DynamoDB Local con el mismo esquema que terraform/modules/data.
 *   pnpm local:up && pnpm local:init
 */
import { CreateTableCommand, DynamoDBClient, ListTablesCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const table = process.env.TABLE_NAME ?? 'orderly';
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
process.env.AWS_REGION ??= 'us-east-1';

const client = new DynamoDBClient({ endpoint });

async function main(): Promise<void> {
  const existing = await client.send(new ListTablesCommand({}));
  if (existing.TableNames?.includes(table)) {
    console.log(`La tabla ${table} ya existe en ${endpoint}`);
    return;
  }
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
    }),
  );
  await client.send(new UpdateTimeToLiveCommand({ TableName: table, TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } }));
  console.log(`Tabla ${table} creada en ${endpoint}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
