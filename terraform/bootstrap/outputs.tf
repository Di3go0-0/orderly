output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "github_deploy_role_arn" {
  description = "Guardar como variable AWS_ROLE_ARN en GitHub."
  value       = module.github_oidc.role_arn
}

output "backend_hcl" {
  description = "Contenido para terraform/envs/dev/backend.hcl"
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.bucket}"
    key          = "envs/dev/terraform.tfstate"
    region       = "${var.region}"
    use_lockfile = true
  EOT
}
