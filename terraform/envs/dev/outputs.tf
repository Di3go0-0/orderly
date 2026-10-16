output "api_url" {
  value = module.api.api_url
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "user_pool_client_id" {
  value = module.auth.client_id
}

output "table_name" {
  value = module.data.name
}

output "event_bus_name" {
  value = module.events.bus_name
}

output "ecr_repository_url" {
  value = module.search.ecr_repository_url
}

output "opensearch_endpoint" {
  value = module.search.opensearch_endpoint
}

output "dlq_urls" {
  value = module.events.dlq_urls
}

output "events_log_group" {
  description = "Aquí se ve cada evento que pasa por el bus."
  value       = "/aws/events/${local.name}"
}
