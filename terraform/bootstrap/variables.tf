variable "region" {
  description = "Región donde vive todo el proyecto."
  type        = string
  default     = "us-east-1"
}

variable "alert_email" {
  description = "Correo que recibe las alertas de presupuesto."
  type        = string
}

variable "budget_limit_usd" {
  description = "Límite mensual en USD. Avisa al 50% real y al 100% proyectado."
  type        = number
  default     = 5
}

variable "github_repo" {
  description = "Repositorio GitHub autorizado a desplegar, formato owner/repo."
  type        = string
  default     = "Di3go0-0/orderly"
}
