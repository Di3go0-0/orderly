#!/usr/bin/env bash
# Crea un usuario en Cognito con contraseña definitiva y lo mete en un grupo.
#   scripts/create-user.sh admin@example.com 'Password-123' admin
#   scripts/create-user.sh cliente@example.com 'Password-123' customer
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:?Uso: create-user.sh <email> <password> <admin|customer>}"
PASSWORD="${2:?Uso: create-user.sh <email> <password> <admin|customer>}"
GROUP="${3:?Uso: create-user.sh <email> <password> <admin|customer>}"
POOL_ID="${COGNITO_USER_POOL_ID:-$(terraform -chdir=terraform/envs/dev output -raw user_pool_id)}"

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS >/dev/null

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --group-name "$GROUP"

echo "Usuario $EMAIL creado en el grupo $GROUP"
