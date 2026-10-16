# Reglas de EventBridge cuyo destino es una Lambda (sin cola intermedia).
# Están aquí y no en modules/events porque necesitan los ARN de las funciones.
locals {
  lambda_rules = {
    StockReserved = { arn = module.orders_confirm.arn, name = module.orders_confirm.name }
    StockRejected = { arn = module.orders_reject.arn, name = module.orders_reject.name }
  }
}

resource "aws_cloudwatch_event_rule" "to_lambda" {
  for_each       = local.lambda_rules
  name           = "${local.name}-${lower(each.key)}"
  event_bus_name = module.events.bus_name
  event_pattern = jsonencode({
    source        = ["orderly.orders"]
    "detail-type" = [each.key]
  })
}

resource "aws_cloudwatch_event_target" "to_lambda" {
  for_each       = local.lambda_rules
  rule           = aws_cloudwatch_event_rule.to_lambda[each.key].name
  event_bus_name = module.events.bus_name
  target_id      = "lambda"
  arn            = each.value.arn

  # Si la Lambda falla, EventBridge reintenta hasta 1 h; luego descarta (aquí no hay DLQ de regla).
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }
}

resource "aws_lambda_permission" "from_eventbridge" {
  for_each      = local.lambda_rules
  statement_id  = "AllowInvokeFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = each.value.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.to_lambda[each.key].arn
}
