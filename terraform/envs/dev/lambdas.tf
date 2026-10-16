# Las ocho funciones. Cada una con SOLO los permisos que usa.

# --- Catalog: CRUD de productos ------------------------------------------------
module "catalog_http" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-catalog-http"
  description = "POST/GET/PUT/DELETE /products"
  source_dir  = "${local.dist}/catalog-http"
  environment = local.common_env
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:TransactWriteItems"]
    resources = [module.data.arn]
  }]
}

# --- Orders: API ---------------------------------------------------------------
module "orders_http" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-orders-http"
  description = "POST /orders, GET /orders/{id}, GET /me/orders"
  source_dir  = "${local.dist}/orders-http"
  environment = local.common_env
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:TransactWriteItems", "dynamodb:PutItem"]
    resources = [module.data.arn, "${module.data.arn}/index/GSI1"]
  }]
}

# --- Outbox relay: DynamoDB Stream -> EventBridge ------------------------------
module "outbox_relay" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-outbox-relay"
  description = "Publica en EventBridge las filas OUTBOX# que aparecen en el stream"
  source_dir  = "${local.dist}/outbox-relay"
  environment = local.common_env
  policy_statements = [
    {
      actions   = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"]
      resources = [module.data.stream_arn]
    },
    {
      actions   = ["events:PutEvents"]
      resources = [module.events.bus_arn]
    },
  ]
}

resource "aws_lambda_event_source_mapping" "outbox_relay" {
  event_source_arn  = module.data.stream_arn
  function_name     = module.outbox_relay.name
  starting_position = "LATEST"
  batch_size        = 10

  # Solo filas nuevas cuyo SK empiece por OUTBOX#: las demás ni siquiera invocan la Lambda.
  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
        dynamodb  = { NewImage = { SK = { S = [{ prefix = "OUTBOX#" }] } } }
      })
    }
  }

  # Si un lote falla, Lambda lo parte en dos y reintenta; reporta solo los registros fallidos.
  bisect_batch_on_function_error = true
  maximum_retry_attempts         = 10
  function_response_types        = ["ReportBatchItemFailures"]
}

# --- Orders: reserva de stock (consume SQS) ------------------------------------
module "orders_reserve_stock" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-orders-reserve-stock"
  description = "Consume OrderPlaced desde inventory-queue y reserva stock"
  source_dir  = "${local.dist}/orders-reserve-stock"
  timeout_s   = local.worker_timeout
  environment = local.common_env
  policy_statements = [
    {
      actions   = ["dynamodb:UpdateItem", "dynamodb:PutItem"]
      resources = [module.data.arn]
    },
    {
      actions   = ["events:PutEvents"]
      resources = [module.events.bus_arn]
    },
    {
      actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      resources = [module.events.inventory_queue_arn]
    },
  ]
}

resource "aws_lambda_event_source_mapping" "reserve_stock" {
  event_source_arn        = module.events.inventory_queue_arn
  function_name           = module.orders_reserve_stock.name
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}

# --- Orders: confirmar / rechazar (targets directos de EventBridge) ------------
module "orders_confirm" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-orders-confirm"
  description = "StockReserved -> ORDER CONFIRMED (+ OrderConfirmed por outbox)"
  source_dir  = "${local.dist}/orders-confirm"
  environment = local.common_env
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:TransactWriteItems"]
    resources = [module.data.arn]
  }]
}

module "orders_reject" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-orders-reject"
  description = "StockRejected -> ORDER REJECTED (compensación de la SAGA)"
  source_dir  = "${local.dist}/orders-reject"
  environment = local.common_env
  policy_statements = [{
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:TransactWriteItems"]
    resources = [module.data.arn]
  }]
}

# --- Search: endpoint HTTP -----------------------------------------------------
module "search_http" {
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-search-http"
  description = "GET /products/search (OpenSearch)"
  source_dir  = "${local.dist}/search-http"
  environment = merge(local.common_env, {
    OPENSEARCH_URL  = module.search.opensearch_endpoint
    OPENSEARCH_AUTH = "sigv4"
  })
  policy_statements = [{
    actions   = ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpHead"]
    resources = ["${module.search.opensearch_domain_arn}/*"]
  }]
}

# --- Search: indexer como IMAGEN DOCKER ----------------------------------------
# Terraform resuelve el digest del tag: si vuelves a subir "latest", el digest cambia
# y la Lambda se actualiza. Con deploy_indexer=false (primer apply) no se crea nada.
data "aws_ecr_image" "indexer" {
  count           = var.deploy_indexer ? 1 : 0
  repository_name = module.search.ecr_repository_name
  image_tag       = var.indexer_image_tag
}

module "search_indexer" {
  count       = var.deploy_indexer ? 1 : 0
  source      = "../../modules/lambda-fn"
  name        = "${local.name}-search-indexer"
  description = "Consume Product* desde index-queue y actualiza OpenSearch (imagen de contenedor)"
  image_uri   = "${module.search.ecr_repository_url}@${data.aws_ecr_image.indexer[0].image_digest}"
  timeout_s   = local.worker_timeout
  memory_mb   = 512
  environment = merge(local.common_env, {
    OPENSEARCH_URL  = module.search.opensearch_endpoint
    OPENSEARCH_AUTH = "sigv4"
  })
  policy_statements = [
    {
      actions   = ["es:ESHttp*"]
      resources = ["${module.search.opensearch_domain_arn}/*"]
    },
    {
      actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      resources = [module.events.index_queue_arn]
    },
  ]
}

resource "aws_lambda_event_source_mapping" "indexer" {
  count                   = var.deploy_indexer ? 1 : 0
  event_source_arn        = module.events.index_queue_arn
  function_name           = module.search_indexer[0].name
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}
