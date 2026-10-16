variable "name" {
  type = string
}

variable "description" {
  type    = string
  default = ""
}

variable "source_dir" {
  description = "Carpeta con index.js (salida de esbuild). Ignorada si image_uri está definido."
  type        = string
  default     = null
}

variable "image_uri" {
  description = "URI de imagen en ECR (repo:tag). Si se define, la función es de tipo Image."
  type        = string
  default     = null
}

variable "handler" {
  type    = string
  default = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "memory_mb" {
  type    = number
  default = 256
}

variable "timeout_s" {
  type    = number
  default = 10
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_statements" {
  description = "Permisos IAM adicionales (mínimo privilegio: solo lo que esta función usa)."
  type = list(object({
    actions   = list(string)
    resources = list(string)
  }))
  default = []
}

variable "log_retention_days" {
  type    = number
  default = 14
}
