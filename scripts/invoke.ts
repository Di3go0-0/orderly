/**
 * Ejecuta un handler en local con un evento JSON, sin SAM ni AWS.
 *
 *   pnpm invoke services/catalog/src/handlers/http.ts events/catalog-create-product.json
 *
 * Carga .env si existe (TABLE_NAME, DYNAMODB_ENDPOINT, OPENSEARCH_URL...).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function loadDotEnv(): void {
  const file = path.resolve('.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? '';
  }
}

async function main(): Promise<void> {
  const [handlerPath, eventPath] = process.argv.slice(2);
  if (!handlerPath || !eventPath) {
    console.error('Uso: pnpm invoke <ruta/al/handler.ts> <ruta/al/evento.json>');
    process.exit(1);
  }
  loadDotEnv();
  const mod = (await import(pathToFileURL(path.resolve(handlerPath)).href)) as { handler: (e: unknown, c: unknown) => Promise<unknown> };
  const event: unknown = JSON.parse(readFileSync(eventPath, 'utf8'));
  const context = { awsRequestId: `local-${Date.now()}`, functionName: path.basename(handlerPath) };
  const result = await mod.handler(event, context);
  console.log('\n--- resultado ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
