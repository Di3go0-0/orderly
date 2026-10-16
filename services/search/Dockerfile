# Lambda "search-indexer" como imagen de contenedor.
# Build desde la RAÍZ del repo (necesita package.json y services/shared):
#   docker build -f services/search/Dockerfile -t orderly-search-indexer .
#
# Etapa 1: compilar con esbuild (igual que las Lambdas zip).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY scripts/build.mjs scripts/build.mjs
COPY services ./services
RUN pnpm build search-indexer

# Etapa 2: imagen base oficial de Lambda. Trae el Runtime Interface Client que
# conecta el proceso Node con el servicio Lambda.
FROM public.ecr.aws/lambda/nodejs:22
COPY --from=build /app/dist/search-indexer/ ${LAMBDA_TASK_ROOT}/
CMD ["index.handler"]
