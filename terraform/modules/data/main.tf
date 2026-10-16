# Tabla única de DynamoDB. Ver services/shared/src/dynamo.ts para el diseño de claves.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  type = string
}

resource "aws_dynamodb_table" "this" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST" # pagas por operación; free tier cubre 25 GB y millones de requests

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # Patrón de acceso secundario: "pedidos de un usuario, ordenados por fecha".
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # El stream es el relay del outbox: cada INSERT llega a la Lambda outbox-relay.
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  # Filas OUTBOX# e IDEMP# llevan ttl y DynamoDB las borra solo.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false # cuesta; en producción sería true
  }
}

output "name" {
  value = aws_dynamodb_table.this.name
}

output "arn" {
  value = aws_dynamodb_table.this.arn
}

output "stream_arn" {
  value = aws_dynamodb_table.this.stream_arn
}
