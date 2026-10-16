# ------------------------------------------------------------------------------
# BOOTSTRAP: lo que se crea UNA sola vez por cuenta, con estado local.
#   - bucket S3 para el estado remoto de los demás entornos (con lock nativo)
#   - alerta de presupuesto (lo primero que debe existir en una cuenta personal)
#   - proveedor OIDC + rol que GitHub Actions asume para desplegar (sin access keys)
#
#   cd terraform/bootstrap
#   terraform init && terraform apply -var alert_email=tu@email.com
# ------------------------------------------------------------------------------
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "orderly"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  state_bucket = "orderly-tfstate-${local.account_id}"
}

# --- Estado remoto -------------------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled" # cada apply deja una versión: se puede volver atrás
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Presupuesto ---------------------------------------------------------------
resource "aws_budgets_budget" "monthly" {
  name         = "orderly-monthly"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# --- GitHub Actions via OIDC ---------------------------------------------------
module "github_oidc" {
  source      = "../modules/github-oidc"
  github_repo = var.github_repo
  role_name   = "orderly-github-deploy"
}
