# Arquitectura de Orderly, explicada

Diagramas interactivos: https://claude.ai/artifact/9HF8HG25Ft6F39h45YmmzJ

## 1. El camino de una petición

1. El cliente hace login en **Cognito** (`USER_PASSWORD_AUTH`) y recibe tres tokens. Usamos el **ID token**: lleva `sub`, `email` y `cognito:groups`.
2. Cada petición HTTP va con `Authorization: Bearer <token>`. **API Gateway** (HTTP API) tiene un *JWT authorizer*: descarga las claves públicas del pool, comprueba firma, expiración, `iss` y `aud`. Si falla, responde 401 y la Lambda ni se ejecuta (ni se paga).
3. La ruta (`POST /products`) decide qué **Lambda** se invoca. Una Lambda atiende varias rutas: `services/shared/src/http.ts` mira `routeKey` y despacha.
4. El handler construye un `Principal` desde los claims (`services/shared/src/auth.ts`) y pide un rol: `requireRole(principal, 'admin')`. Eso es **RBAC**: el rol viene firmado en el token, nadie puede inventárselo.

## 2. Hexagonal en cada contexto

```
handlers/        adaptadores de ENTRADA: traducen un evento de AWS (HTTP, SQS, EventBridge) a una llamada
application/     casos de uso: orquestan dominio + puertos (CreateProduct, PlaceOrder, ReserveStock...)
domain/          entidades con reglas (Product, Order) y PUERTOS (interfaces: ProductRepository, Inventory...)
infrastructure/  adaptadores de SALIDA: implementan los puertos con DynamoDB, EventBridge, OpenSearch
```

Regla única: las dependencias apuntan hacia adentro. `domain/` y `application/` importan solo de `@orderly/shared` (la parte pura); ESLint lo vigila (`eslint.config.mjs`, regla `no-restricted-imports`).

Por qué importa: los tests de `services/orders/src/application/saga.test.ts` ejecutan la SAGA completa con Maps en memoria. Mismo código que en producción, cero red.

## 3. DynamoDB: una tabla para todo

| PK | SK | GSI1PK | GSI1SK | Qué es |
|---|---|---|---|---|
| `PRODUCT#<id>` | `META` | | | producto |
| `ORDER#<id>` | `META` | `USER#<sub>` | `ORDER#<ts>#<id>` | pedido (líneas embebidas) |
| `<PK del agregado>` | `OUTBOX#<eventId>` | | | evento pendiente de publicar (ttl 24 h) |
| `IDEMP#<consumer>#<eventId>` | `META` | | | "ya procesado" (ttl 7 días) |

- `GetItem` por PK+SK es el acceso principal (ms de latencia, coste fijo).
- El **GSI1** responde "pedidos de un usuario, ordenados por fecha" con un `Query`.
- No hay joins: el pedido guarda sus líneas y el precio congelado. Si el catálogo cambia después, el pedido no.

## 4. Outbox: por qué no publicamos el evento desde la Lambda

Si `place-order` escribiera en DynamoDB y luego llamara a EventBridge, podría fallar entre ambos: pedido sin evento (nunca se procesa) o evento sin pedido (si invertimos el orden). Es el problema del *dual write*.

Solución: el pedido y su evento se escriben en **una transacción** (`TransactWriteItems`). El evento es una fila más (`OUTBOX#`). **DynamoDB Streams** entrega cada fila nueva a la Lambda `outbox-relay`, que la publica en EventBridge. El *event source mapping* tiene un filtro (`SK` empieza por `OUTBOX#`), así las filas normales ni invocan la Lambda.

Si EventBridge falla, el relay devuelve el registro fallido y Lambda reintenta desde ahí (los streams son ordenados). Las filas OUTBOX tienen `ttl` y DynamoDB las borra solo.

## 5. EventBridge: el centro de distribución

Un bus propio (`orderly-dev`). Cada evento lleva `source = orderly.<contexto>` y `detail-type = <EventType>`. Las **reglas** son patrones JSON:

| Regla | Patrón | Destino |
|---|---|---|
| order-placed | `detail-type: OrderPlaced` | SQS inventory-queue |
| product-changed | `detail-type: prefix "Product"` | SQS index-queue |
| stockreserved | `detail-type: StockReserved` | Lambda confirm-order |
| stockrejected | `detail-type: StockRejected` | Lambda reject-order |
| order-confirmed | `detail-type: OrderConfirmed` | SNS (con *input transformer*: texto legible) |
| all-to-logs | `source: prefix "orderly."` | CloudWatch Logs `/aws/events/orderly-dev` |

Quien publica no sabe quién consume. Añadir un consumidor nuevo es añadir una regla, sin tocar el productor. El **archive** de 7 días permite reproducir eventos.

## 6. SQS: por qué hay una cola entre EventBridge y el worker

EventBridge podría invocar `reserve-stock` directamente (como hace con confirm/reject). La cola aporta:

- **Buffer**: si llegan 1000 pedidos, la cola los guarda y la Lambda los procesa a su ritmo.
- **Reintentos controlados**: si la Lambda falla, el mensaje vuelve a ser visible tras el *visibility timeout* (6× el timeout de la Lambda).
- **DLQ**: tras 3 fallos (`maxReceiveCount`), el mensaje va a `inventory-dlq`. No se pierde; lo miras después.
- **Lotes**: la Lambda recibe hasta 5 mensajes; con `ReportBatchItemFailures` devuelve solo los que fallaron.

## 7. La SAGA

Un pedido toca dos cosas: el pedido y el stock. No hay transacción que abarque ambas a lo largo del tiempo, así que se coordina por eventos:

1. `OrderPlaced` → `reserve-stock` descuenta stock con un `UpdateItem` condicional (`stock >= :q`). DynamoDB evalúa la condición de forma atómica: dos pedidos simultáneos nunca dejan stock negativo.
2. Si una línea falla, **compensa** devolviendo las líneas ya reservadas y publica `StockRejected`.
3. `StockReserved` → `confirm-order`; `StockRejected` → `reject-order`. Ambos pasan por la máquina de estados de `Order`: solo desde `PENDING`. Reentregas del mismo evento son un *no-op* registrado como warning.

**Idempotencia**: SQS entrega "al menos una vez". Antes de descontar stock, `reserve-stock` reclama el `eventId` con un `PutItem` condicional (`IDEMP#`). El segundo intento ve que ya existe y no hace nada.

## 8. OpenSearch como proyección

DynamoDB no sabe buscar "zapato" con errores de tipeo ni ordenar por relevancia. OpenSearch sí: índice invertido, `multi_match` con `fuzziness`. Pero no es la fuente de verdad: es una **copia** que se mantiene al día con los eventos `Product*`.

El indexer corre como **imagen Docker**: `services/search/Dockerfile` compila con esbuild y copia el resultado a la imagen base oficial de Lambda. Terraform crea el repositorio ECR y resuelve el *digest* del tag `latest`: cada vez que subes una imagen nueva, el digest cambia y la Lambda se actualiza.

Las Lambdas firman las peticiones a OpenSearch con **SigV4** (su propio rol IAM); la política del dominio permite la cuenta, y las políticas IAM de cada Lambda dicen quién puede qué.

## 9. Seguridad (lo que OWASP pide, traducido)

| Riesgo | Qué hacemos |
|---|---|
| Autenticación rota | Cognito emite y firma; API Gateway verifica antes de la Lambda. Sin contraseñas en nuestro código. |
| Control de acceso roto | RBAC por claim firmado; un customer solo ve sus pedidos (y recibe 404, no 403, para no revelar ids ajenos). |
| Inyección / datos inválidos | zod en cada borde, ids con regex, cuerpo máximo 64 KB. |
| Consumo de recursos | throttling en API Gateway (10 rps, burst 20), timeouts cortos, DLQ en vez de reintentos infinitos. |
| Configuración insegura | un rol IAM por Lambda con solo sus acciones; cifrado en SQS, S3 y OpenSearch; HTTPS forzado. |
| Fuga de información | errores 500 sin stack trace; logs JSON sin tokens ni cuerpos. |
| Cadena de suministro | `pnpm audit` en CI, versiones fijadas, escaneo de imagen en ECR. |
| Credenciales en CI | OIDC: GitHub asume un rol limitado a este repo; no hay access keys. |

## 10. Terraform

- `bootstrap/` (una vez por cuenta): bucket de estado con versionado y lock nativo, presupuesto, rol OIDC.
- `modules/lambda-fn` se instancia 8 veces: zip desde `dist/` o imagen; rol propio; log group con retención.
- `envs/dev/main.tf` se lee de arriba a abajo como el flujo: auth → data → events → search → api.
- `enable_opensearch` usa `count` para que un recurso caro exista solo cuando lo pides.
- `deploy_indexer` rompe el ciclo "la imagen necesita ECR, la Lambda necesita la imagen".

## 11. Atajos conscientes (y qué sería distinto en producción)

- `orders` escribe el stock de `PRODUCT#` directamente. En un sistema grande sería una llamada al contexto Catalog o un evento `ReserveStock` que Catalog consume.
- `reserve-stock` publica en EventBridge directamente (no por outbox): si fallara tras descontar stock, el reintento de SQS volvería a entrar y la idempotencia lo pararía sin publicar. Un outbox aquí también sería más robusto.
- Una sola tabla y un solo entorno. Producción tendría `envs/prod`, PITR activado, alarmas en las DLQ y X-Ray.
