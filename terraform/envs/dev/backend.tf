# Estado remoto en S3. Los valores concretos (bucket, región) no pueden ser variables,
# así que se pasan al hacer init:
#   terraform init -backend-config=backend.hcl
# backend.hcl está en .gitignore; copia backend.hcl.example y rellena el bucket
# (lo imprime `terraform output backend_hcl` en terraform/bootstrap).
terraform {
  backend "s3" {}
}
