#!/usr/bin/env bash
# Obtiene un ID token de Cognito para usar en curl.
#   export TOKEN=$(scripts/get-token.sh <email> <password>)
# Usa los outputs de Terraform (user_pool_client_id) y AWS_REGION.
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:?Uso: get-token.sh <email> <password>}"
PASSWORD="${2:?Uso: get-token.sh <email> <password>}"
CLIENT_ID="${COGNITO_CLIENT_ID:-$(terraform -chdir=terraform/envs/dev output -raw user_pool_client_id)}"

aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --query 'AuthenticationResult.IdToken' \
  --output text
