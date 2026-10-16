#!/usr/bin/env bash
# Valida sintaxis y referencias de todos los directorios Terraform sin tocar AWS.
set -euo pipefail
cd "$(dirname "$0")/.."

terraform fmt -check -recursive terraform

for dir in terraform/bootstrap terraform/envs/dev; do
  echo "== $dir"
  terraform -chdir="$dir" init -backend=false -input=false >/dev/null
  terraform -chdir="$dir" validate
done
