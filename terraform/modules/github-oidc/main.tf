# GitHub Actions obtiene credenciales temporales de AWS presentando su token OIDC.
# No hay access keys que rotar ni que se puedan filtrar.
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "github_repo" {
  type = string
}

variable "role_name" {
  type = string
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS valida el certificado de GitHub por su cuenta; los thumbprints son solo requeridos por el API.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# Solo workflows de ESTE repo, en main o en pull requests, pueden asumir el rol.
data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Terraform necesita crear de todo (Lambda, SQS, Cognito...). PowerUser lo cubre
# excepto IAM; IAM lo limitamos a recursos con prefijo "orderly-".
resource "aws_iam_role_policy_attachment" "poweruser" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "iam_scoped" {
  statement {
    effect = "Allow"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole", "iam:TagRole", "iam:UntagRole",
      "iam:PassRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/orderly-*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy", "iam:GetPolicyVersion",
      "iam:ListPolicyVersions", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:TagPolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/orderly-*"]
  }
  statement {
    # OpenSearch y Lambda necesitan service-linked roles la primera vez.
    effect    = "Allow"
    actions   = ["iam:CreateServiceLinkedRole", "iam:GetRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/*"]
  }
}

resource "aws_iam_role_policy" "iam_scoped" {
  name   = "orderly-iam-scoped"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.iam_scoped.json
}

output "role_arn" {
  value = aws_iam_role.deploy.arn
}
