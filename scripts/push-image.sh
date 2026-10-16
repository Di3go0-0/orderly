#!/usr/bin/env bash
# Construye la imagen del indexer y la sube a ECR.
#   scripts/push-image.sh <ecr_repository_url> [tag]
# El repositorio ECR lo crea Terraform (output ecr_repository_url).
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_URL="${1:?Uso: push-image.sh <ecr_repository_url> [tag]}"
TAG="${2:-$(git rev-parse --short HEAD)}"
REGION="${AWS_REGION:-us-east-1}"
REGISTRY="${REPO_URL%%/*}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -f services/search/Dockerfile -t "$REPO_URL:$TAG" .
docker push "$REPO_URL:$TAG"
echo "Imagen publicada: $REPO_URL:$TAG"
echo "Ahora: terraform -chdir=terraform/envs/dev apply -var image_tag=$TAG"
