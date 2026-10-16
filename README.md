# Orderly

Mini plataforma de pedidos (catálogo, pedidos, búsqueda) construida 100 % serverless en AWS.
El dominio es deliberadamente pequeño; la gracia está en cómo se conectan las piezas.

| Concepto | Dónde se ve |
|---|---|
| Arquitectura hexagonal + DDD | `services/*/src/{domain,application,infrastructure,handlers}` |
| Outbox transaccional | `DynamoProductRepository` / `DynamoOrderRepository` + `services/outbox-relay` |
| Event-driven (EventBridge, SQS, SNS) | `terraform/modules/events`, `terraform/envs/dev/routing.tf` |
| SAGA con compensación e idempotencia | `services/orders/src/application/reserve-stock.ts` |
| DynamoDB single table design | `services/shared/src/dynamo.ts`, `terraform/modules/data` |
| OpenSearch como proyección de lectura | `services/search` |
| Lambda como imagen Docker (ECR) | `services/search/Dockerfile`, `terraform/envs/dev/lambdas.tf` |
| JWT + RBAC (Cognito) | `terraform/modules/auth`, `services/shared/src/auth.ts` |
| OWASP en la práctica | validación zod, throttling, mínimo privilegio IAM por Lambda, OIDC sin access keys, 404 en vez de 403 para no enumerar |
| Terraform con módulos y estado remoto | `terraform/` |
| CI/CD con GitHub Actions | `.github/workflows/` |

Diagramas y explicación paso a paso: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
Cómo desplegar en tu cuenta: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Flujo de un pedido

```
POST /orders ─► Lambda place-order ─► DynamoDB (ORDER PENDING + OUTBOX OrderPlaced)   ← 1 transacción
                                           │ stream
                                    Lambda outbox-relay ─► EventBridge bus
                                                              │ regla OrderPlaced
                                                         SQS inventory-queue (+DLQ)
                                                              │
                                                       Lambda reserve-stock ─ UPDATE stock si stock ≥ qty
                                                              │
                                     StockReserved ◄──────────┴──────────► StockRejected
                                          │                                     │
                                  Lambda confirm-order                    Lambda reject-order
                                  ORDER CONFIRMED                         ORDER REJECTED (compensación)
                                  OrderConfirmed ─► EventBridge ─► SNS ─► email
```

El catálogo usa el mismo mecanismo: `POST /products` escribe `PRODUCT` + `OUTBOX ProductCreated`;
la regla `Product*` lo manda a `index-queue` y la Lambda indexer (imagen Docker) lo escribe en OpenSearch.

## API

Todas las rutas requieren `Authorization: Bearer <ID token de Cognito>`.

| Ruta | Rol | Qué hace |
|---|---|---|
| `POST /products` | admin | crea producto |
| `GET /products/{id}` | admin, customer | lee producto |
| `PUT /products/{id}` | admin | actualiza |
| `DELETE /products/{id}` | admin | borra |
| `GET /products/search?q=&limit=&inStock=` | admin, customer | búsqueda full-text en OpenSearch |
| `POST /orders` | customer, admin | crea pedido (`{"lines":[{"productId","quantity"}]}`) |
| `GET /orders/{id}` | dueño o admin | estado del pedido |
| `GET /me/orders` | customer, admin | mis pedidos |

## Desarrollo local

```bash
pnpm install
pnpm test                 # unit tests del dominio y casos de uso (sin AWS)
pnpm lint && pnpm typecheck
pnpm build                # dist/<fn>/index.js por cada Lambda

# Infra local para los adaptadores
pnpm local:up             # OpenSearch :9200 + DynamoDB Local :8000
pnpm local:init           # crea la tabla "orderly"
cp .env.example .env
pnpm invoke services/catalog/src/handlers/http.ts events/catalog-create-product.json
pnpm invoke services/search/src/handlers/sqs-indexer.ts events/sqs-product-created.json
pnpm invoke services/search/src/handlers/http-search.ts events/search-query.json
pnpm test:integration     # tests contra OpenSearch local
pnpm local:down
```

## Estructura

```
services/
  shared/         errores, logger, eventos, auth/RBAC, router HTTP, DynamoDB, idempotencia, SQS, EventBridge
  catalog/        Product, CRUD, repositorio DynamoDB con outbox
  orders/         Order (máquina de estados), PlaceOrder, ReserveStock, Confirm/Reject
  search/         ProductIndex, adaptador OpenSearch, Dockerfile del indexer
  outbox-relay/   DynamoDB Stream -> EventBridge
terraform/
  bootstrap/      bucket de estado, presupuesto, rol OIDC para GitHub (una vez por cuenta)
  modules/        lambda-fn, auth, data, events, api, search, github-oidc
  envs/dev/       composición del entorno
scripts/          build, invoke local, crear usuario, obtener token, smoke test, push de imagen
events/           eventos de ejemplo para invocar handlers en local
.github/workflows CI (PR) y Deploy (main) con OIDC
```

## Costo

Con el tráfico de una persona todo cabe en la capa gratuita salvo **OpenSearch** (~0.036 USD/h, t3.small).
Está apagado por defecto (`enable_opensearch = false`); se enciende para probar y se destruye el mismo día.
El bootstrap crea una alerta de presupuesto de 5 USD antes que cualquier otra cosa.
