# Bus de EventBridge, colas SQS (con DLQ), topic SNS y las reglas cuyo destino es una cola,
# el topic o CloudWatch. Las reglas con destino Lambda viven en envs/dev/routing.tf
# (necesitan los ARN de las funciones, que a su vez necesitan el ARN del bus).
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  type = string
}

variable "notification_email" {
  description = "Correo suscrito al topic SNS (recibirá un email de confirmación de AWS)."
  type        = string
}

variable "lambda_timeout_s" {
  description = "Timeout de los consumidores; el visibility timeout de SQS debe ser mayor."
  type        = number
  default     = 10
}

# --- Bus -----------------------------------------------------------------------
resource "aws_cloudwatch_event_bus" "this" {
  name = var.name
}

# Archivo de 7 días: permite "replay" de eventos para depurar o reconstruir proyecciones.
resource "aws_cloudwatch_event_archive" "this" {
  name             = "${var.name}-archive"
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  retention_days   = 7
  event_pattern = jsonencode({
    source = [{ prefix = "orderly." }]
  })
}

# --- Colas con DLQ -------------------------------------------------------------
locals {
  queues = {
    inventory = "Consume OrderPlaced y reserva stock"
    index     = "Consume Product* y actualiza OpenSearch"
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queues
  name                      = "${var.name}-${each.key}-dlq"
  message_retention_seconds = 14 * 24 * 60 * 60 # 14 días para mirar qué falló
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "main" {
  for_each                   = local.queues
  name                       = "${var.name}-${each.key}"
  visibility_timeout_seconds = var.lambda_timeout_s * 6 # recomendación AWS: 6x el timeout de la Lambda
  message_retention_seconds  = 4 * 24 * 60 * 60
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 3 # tres fallos y el mensaje pasa a la DLQ
  })
}

# --- Reglas -> colas -----------------------------------------------------------
resource "aws_cloudwatch_event_rule" "order_placed" {
  name           = "${var.name}-order-placed"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source        = ["orderly.orders"]
    "detail-type" = ["OrderPlaced"]
  })
}

resource "aws_cloudwatch_event_target" "order_placed_to_inventory" {
  rule           = aws_cloudwatch_event_rule.order_placed.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "inventory-queue"
  arn            = aws_sqs_queue.main["inventory"].arn
}

resource "aws_cloudwatch_event_rule" "product_changed" {
  name           = "${var.name}-product-changed"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source        = ["orderly.catalog"]
    "detail-type" = [{ prefix = "Product" }] # ProductCreated | ProductUpdated | ProductDeleted
  })
}

resource "aws_cloudwatch_event_target" "product_changed_to_index" {
  rule           = aws_cloudwatch_event_rule.product_changed.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "index-queue"
  arn            = aws_sqs_queue.main["index"].arn
}

# EventBridge necesita permiso explícito para escribir en cada cola.
data "aws_iam_policy_document" "queue_policy" {
  for_each = local.queues
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [each.key == "inventory" ? aws_cloudwatch_event_rule.order_placed.arn : aws_cloudwatch_event_rule.product_changed.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "main" {
  for_each  = local.queues
  queue_url = aws_sqs_queue.main[each.key].id
  policy    = data.aws_iam_policy_document.queue_policy[each.key].json
}

# --- SNS: OrderConfirmed -> email ----------------------------------------------
resource "aws_sns_topic" "notifications" {
  name = "${var.name}-order-notifications"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

data "aws_iam_policy_document" "topic_policy" {
  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.notifications.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "notifications" {
  arn    = aws_sns_topic.notifications.arn
  policy = data.aws_iam_policy_document.topic_policy.json
}

resource "aws_cloudwatch_event_rule" "order_confirmed" {
  name           = "${var.name}-order-confirmed"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source        = ["orderly.orders"]
    "detail-type" = ["OrderConfirmed"]
  })
}

# Sin Lambda: EventBridge transforma el evento en texto y lo publica en SNS.
resource "aws_cloudwatch_event_target" "order_confirmed_to_sns" {
  rule           = aws_cloudwatch_event_rule.order_confirmed.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "sns-email"
  arn            = aws_sns_topic.notifications.arn

  input_transformer {
    input_paths = {
      orderId = "$.detail.payload.orderId"
      total   = "$.detail.payload.totalCents"
      email   = "$.detail.payload.customerEmail"
    }
    input_template = "\"Pedido <orderId> confirmado. Total: <total> centavos. Cliente: <email>.\""
  }
}

# --- Espejo de TODO el bus a CloudWatch Logs (observabilidad barata) -------------
resource "aws_cloudwatch_log_group" "bus" {
  name              = "/aws/events/${var.name}"
  retention_in_days = 7
}

data "aws_iam_policy_document" "log_policy" {
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.bus.arn}:*"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "bus" {
  policy_name     = "${var.name}-events-to-logs"
  policy_document = data.aws_iam_policy_document.log_policy.json
}

resource "aws_cloudwatch_event_rule" "all_to_logs" {
  name           = "${var.name}-all-to-logs"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source = [{ prefix = "orderly." }]
  })
}

resource "aws_cloudwatch_event_target" "all_to_logs" {
  rule           = aws_cloudwatch_event_rule.all_to_logs.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "cloudwatch-logs"
  arn            = aws_cloudwatch_log_group.bus.arn
}

# --- Outputs -------------------------------------------------------------------
output "bus_name" {
  value = aws_cloudwatch_event_bus.this.name
}

output "bus_arn" {
  value = aws_cloudwatch_event_bus.this.arn
}

output "inventory_queue_arn" {
  value = aws_sqs_queue.main["inventory"].arn
}

output "inventory_queue_url" {
  value = aws_sqs_queue.main["inventory"].url
}

output "index_queue_arn" {
  value = aws_sqs_queue.main["index"].arn
}

output "index_queue_url" {
  value = aws_sqs_queue.main["index"].url
}

output "dlq_urls" {
  value = { for k, q in aws_sqs_queue.dlq : k => q.url }
}

output "topic_arn" {
  value = aws_sns_topic.notifications.arn
}
