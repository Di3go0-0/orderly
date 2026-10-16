# Entorno dev: compone los módulos. Leer de arriba a abajo sigue el flujo de una petición.
locals {
  name           = "orderly-${var.env}"
  dist           = "${path.module}/../../../dist"
  worker_timeout = 15

  common_env = {
    TABLE_NAME     = module.data.name
    EVENT_BUS_NAME = module.events.bus_name
    LOG_LEVEL      = var.log_level
  }
}

# 1. Identidad
module "auth" {
  source = "../../modules/auth"
  name   = local.name
}

# 2. Datos
module "data" {
  source = "../../modules/data"
  name   = local.name
}

# 3. Mensajería: bus, colas, DLQs, SNS
module "events" {
  source             = "../../modules/events"
  name               = local.name
  notification_email = var.notification_email
  lambda_timeout_s   = local.worker_timeout
}

# 4. Búsqueda: ECR siempre, OpenSearch solo si enable_opensearch
module "search" {
  source            = "../../modules/search"
  name              = local.name
  enable_opensearch = var.enable_opensearch
}

# 5. Puerta HTTP (las Lambdas están en lambdas.tf)
module "api" {
  source       = "../../modules/api"
  name         = local.name
  jwt_issuer   = module.auth.issuer
  jwt_audience = module.auth.client_id

  routes = {
    "POST /products"        = { lambda_arn = module.catalog_http.invoke_arn, lambda_name = module.catalog_http.name }
    "GET /products/{id}"    = { lambda_arn = module.catalog_http.invoke_arn, lambda_name = module.catalog_http.name }
    "PUT /products/{id}"    = { lambda_arn = module.catalog_http.invoke_arn, lambda_name = module.catalog_http.name }
    "DELETE /products/{id}" = { lambda_arn = module.catalog_http.invoke_arn, lambda_name = module.catalog_http.name }
    "GET /products/search"  = { lambda_arn = module.search_http.invoke_arn, lambda_name = module.search_http.name }
    "POST /orders"          = { lambda_arn = module.orders_http.invoke_arn, lambda_name = module.orders_http.name }
    "GET /orders/{id}"      = { lambda_arn = module.orders_http.invoke_arn, lambda_name = module.orders_http.name }
    "GET /me/orders"        = { lambda_arn = module.orders_http.invoke_arn, lambda_name = module.orders_http.name }
  }
}
