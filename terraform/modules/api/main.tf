# API Gateway HTTP API con JWT authorizer de Cognito.
# Cada entrada de `routes` ("POST /products" => lambda) crea integración + ruta.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  type = string
}

variable "jwt_issuer" {
  type = string
}

variable "jwt_audience" {
  description = "Client id de Cognito: el token debe haberse emitido para él."
  type        = string
}

variable "routes" {
  description = "Mapa routeKey => { lambda_arn, lambda_name }"
  type = map(object({
    lambda_arn  = string
    lambda_name = string
  }))
}

variable "throttle_rate" {
  type    = number
  default = 10 # requests/segundo sostenidos
}

variable "throttle_burst" {
  type    = number
  default = 20
}

resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = [var.jwt_audience]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = var.routes
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "this" {
  for_each           = var.routes
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambda[each.key].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Permiso para que API Gateway invoque cada Lambda (una vez por función, no por ruta).
resource "aws_lambda_permission" "api" {
  for_each      = toset(distinct([for r in var.routes : r.lambda_name]))
  statement_id  = "AllowInvokeFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  # Throttling: protege contra abuso y contra tu propio presupuesto.
  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      ip        = "$context.identity.sourceIp"
      method    = "$context.httpMethod"
      route     = "$context.routeKey"
      status    = "$context.status"
      latency   = "$context.responseLatency"
      sub       = "$context.authorizer.claims.sub"
      error     = "$context.error.message"
    })
  }
}

output "api_url" {
  value = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  value = aws_apigatewayv2_api.this.id
}
