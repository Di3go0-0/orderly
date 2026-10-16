# Módulo genérico de función Lambda. Se usa ~8 veces con distintos parámetros.
# Soporta dos empaquetados: zip (desde una carpeta dist/) o imagen de contenedor (ECR).
terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

locals {
  is_image = var.image_uri != null
}

# Zip de la carpeta dist/<fn>/ (solo cuando no es imagen).
data "archive_file" "zip" {
  count       = local.is_image ? 0 : 1
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${var.source_dir}.zip"
}

# --- Rol: uno por función, mínimo privilegio -----------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Permite escribir logs en CloudWatch.
resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "inline" {
  count = length(var.policy_statements) > 0 ? 1 : 0
  dynamic "statement" {
    for_each = var.policy_statements
    content {
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "inline" {
  count  = length(var.policy_statements) > 0 ? 1 : 0
  name   = "${var.name}-permissions"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.inline[0].json
}

# --- Logs con retención (sin esto, CloudWatch guarda para siempre) -------------
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

# --- La función ----------------------------------------------------------------
resource "aws_lambda_function" "this" {
  function_name = var.name
  description   = var.description
  role          = aws_iam_role.this.arn
  memory_size   = var.memory_mb
  timeout       = var.timeout_s
  architectures = ["x86_64"]

  package_type = local.is_image ? "Image" : "Zip"

  # Zip
  filename         = local.is_image ? null : data.archive_file.zip[0].output_path
  source_code_hash = local.is_image ? null : data.archive_file.zip[0].output_base64sha256
  handler          = local.is_image ? null : var.handler
  runtime          = local.is_image ? null : var.runtime

  # Imagen
  image_uri = var.image_uri

  environment {
    variables = var.environment
  }

  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy_attachment.basic]
}
