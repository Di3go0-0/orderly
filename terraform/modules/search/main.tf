# ECR para la imagen del indexer + dominio OpenSearch OPCIONAL (count).
# OpenSearch es el único servicio del proyecto que cuesta aunque no lo uses
# (~0.036 USD/h en t3.small). Se enciende con enable_opensearch = true y se destruye después.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  type = string
}

variable "enable_opensearch" {
  type    = bool
  default = false
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# --- ECR -----------------------------------------------------------------------
resource "aws_ecr_repository" "indexer" {
  name                 = "${var.name}/search-indexer"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # permite terraform destroy aunque haya imágenes

  image_scanning_configuration {
    scan_on_push = true # escaneo de vulnerabilidades gratis
  }
}

# Conserva solo las últimas 5 imágenes (el free tier de ECR es 500 MB).
resource "aws_ecr_lifecycle_policy" "indexer" {
  repository = aws_ecr_repository.indexer.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 5"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

# --- OpenSearch ----------------------------------------------------------------
locals {
  domain_name = "${var.name}-search"
  # ARN predecible: las Lambdas pueden referenciarlo aunque el dominio no exista todavía.
  domain_arn = "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${local.domain_name}"
}

# Política de acceso: cualquier identidad IAM de ESTA cuenta puede llamar al dominio.
# Quién puede realmente lo decide la política IAM de cada Lambda (mínimo privilegio).
data "aws_iam_policy_document" "domain_access" {
  statement {
    effect    = "Allow"
    actions   = ["es:ESHttp*"]
    resources = ["${local.domain_arn}/*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_opensearch_domain" "this" {
  count          = var.enable_opensearch ? 1 : 0
  domain_name    = local.domain_name
  engine_version = "OpenSearch_2.17"

  cluster_config {
    instance_type  = "t3.small.search"
    instance_count = 1
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = 10
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  access_policies = data.aws_iam_policy_document.domain_access.json
}

output "ecr_repository_url" {
  value = aws_ecr_repository.indexer.repository_url
}

output "ecr_repository_name" {
  value = aws_ecr_repository.indexer.name
}

output "opensearch_endpoint" {
  description = "URL https del dominio, o cadena vacía si está apagado."
  value       = var.enable_opensearch ? "https://${aws_opensearch_domain.this[0].endpoint}" : ""
}

output "opensearch_domain_arn" {
  value = local.domain_arn
}
