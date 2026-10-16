variable "region" {
  type    = string
  default = "us-east-1"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "notification_email" {
  description = "Correo que recibe los emails de SNS cuando un pedido se confirma."
  type        = string
}

variable "enable_opensearch" {
  description = "Crea el dominio OpenSearch (cuesta ~0.036 USD/h). Apagado por defecto."
  type        = bool
  default     = false
}

variable "deploy_indexer" {
  description = "Despliega la Lambda indexer (imagen). false solo en el primer apply, antes de subir la imagen a ECR."
  type        = bool
  default     = true
}

variable "indexer_image_tag" {
  description = "Tag de la imagen del indexer en ECR. Terraform resuelve su digest, así cada push de 'latest' actualiza la Lambda."
  type        = string
  default     = "latest"
}

variable "log_level" {
  type    = string
  default = "info"
}
