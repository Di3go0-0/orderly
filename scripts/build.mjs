// Empaqueta cada handler de Lambda en un único archivo dist/<nombre>/index.js.
// Terraform zipea cada carpeta dist/<nombre>; el Dockerfile copia la del indexer.
//
// Uso:  node scripts/build.mjs            -> todas las funciones
//       node scripts/build.mjs search-indexer orders-http -> solo esas
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';

export const FUNCTIONS = {
  'catalog-http': 'services/catalog/src/handlers/http.ts',
  'orders-http': 'services/orders/src/handlers/http.ts',
  'orders-reserve-stock': 'services/orders/src/handlers/sqs-reserve-stock.ts',
  'orders-confirm': 'services/orders/src/handlers/eb-confirm-order.ts',
  'orders-reject': 'services/orders/src/handlers/eb-reject-order.ts',
  'outbox-relay': 'services/outbox-relay/src/handler.ts',
  'search-http': 'services/search/src/handlers/http-search.ts',
  'search-indexer': 'services/search/src/handlers/sqs-indexer.ts',
};

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : Object.keys(FUNCTIONS);

for (const name of names) {
  const entry = FUNCTIONS[name];
  if (!entry) {
    console.error(`Función desconocida: ${name}. Opciones: ${Object.keys(FUNCTIONS).join(', ')}`);
    process.exit(1);
  }
  const outdir = path.join('dist', name);
  await rm(outdir, { recursive: true, force: true });
  await build({
    entryPoints: { index: entry },
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: false,
    minify: false, // legible en la consola de Lambda; el tamaño no es problema aquí
    treeShaking: true,
    logLevel: 'info',
    // El runtime de Lambda ya trae el SDK v3, pero lo empaquetamos para fijar la versión
    // y que el comportamiento local y en AWS sea idéntico.
    external: [],
  });
}
