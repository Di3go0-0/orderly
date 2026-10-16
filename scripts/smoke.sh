#!/usr/bin/env bash
# Prueba de punta a punta contra el entorno desplegado.
#   ADMIN_TOKEN=... CUSTOMER_TOKEN=... scripts/smoke.sh
# Requiere: jq, curl, y los tokens (ver scripts/get-token.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

API="${API_URL:-$(terraform -chdir=terraform/envs/dev output -raw api_url)}"
: "${ADMIN_TOKEN:?Falta ADMIN_TOKEN}"
: "${CUSTOMER_TOKEN:?Falta CUSTOMER_TOKEN}"

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

step "1. admin crea un producto con stock 3"
PRODUCT=$(curl -fsS -X POST "$API/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Zapato rojo","description":"Cuero, talla 42","priceCents":129900,"stock":3,"tags":["calzado","rojo"]}')
echo "$PRODUCT" | jq .
PID=$(echo "$PRODUCT" | jq -r .id)

step "2. customer intenta crear un producto -> 403 esperado"
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$API/products" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'content-type: application/json' -d '{"name":"x","priceCents":1,"stock":1}'

step "3. customer crea un pedido de 2 unidades (hay 3)"
ORDER=$(curl -fsS -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'content-type: application/json' \
  -d "{\"lines\":[{\"productId\":\"$PID\",\"quantity\":2}]}")
echo "$ORDER" | jq .
OID=$(echo "$ORDER" | jq -r .id)

step "4. esperando a la SAGA (stream -> EventBridge -> SQS -> Lambda -> EventBridge -> Lambda)"
for i in $(seq 1 20); do
  STATUS=$(curl -fsS "$API/orders/$OID" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq -r .status)
  echo "  intento $i: $STATUS"
  [ "$STATUS" != "PENDING" ] && break
  sleep 2
done
[ "$STATUS" = "CONFIRMED" ] || { echo "Esperaba CONFIRMED"; exit 1; }

step "5. el stock bajó a 1"
curl -fsS "$API/products/$PID" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq '{id, stock}'

step "6. pedido de 5 unidades (solo queda 1) -> REJECTED esperado"
OID2=$(curl -fsS -X POST "$API/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'content-type: application/json' \
  -d "{\"lines\":[{\"productId\":\"$PID\",\"quantity\":5}]}" | jq -r .id)
for i in $(seq 1 20); do
  STATUS=$(curl -fsS "$API/orders/$OID2" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq -r .status)
  echo "  intento $i: $STATUS"
  [ "$STATUS" != "PENDING" ] && break
  sleep 2
done
[ "$STATUS" = "REJECTED" ] || { echo "Esperaba REJECTED"; exit 1; }
curl -fsS "$API/products/$PID" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq '{id, stock}'

step "7. búsqueda (503 si OpenSearch está apagado)"
curl -sS -w '\nHTTP %{http_code}\n' "$API/products/search?q=zapato" -H "Authorization: Bearer $CUSTOMER_TOKEN"

step "8. mis pedidos"
curl -fsS "$API/me/orders" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq '.items[] | {id, status, totalCents}'

echo
echo "Smoke test OK"
