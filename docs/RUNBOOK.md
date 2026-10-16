# Runbook: desplegar Orderly en tu cuenta AWS

Pensado para hacerlo una vez, con calma, entendiendo cada paso. Tiempo estimado: 1 hora.

## 0. Requisitos en tu máquina

```bash
# Arch Linux
sudo pacman -S aws-cli-v2 jq
# Terraform: pacman -S terraform, o el binario en ~/.local/bin (ya instalado)
terraform version   # >= 1.10
aws --version
docker --version
node --version      # >= 22
```

## 1. La cuenta AWS (una sola vez)

1. **No uses el usuario root** para el día a día. En IAM crea un usuario `diego-admin` con `AdministratorAccess` y activa **MFA** en él y en root.
2. Crea una **access key** para ese usuario (IAM → Security credentials) y configúrala:
   ```bash
   aws configure            # Access key, Secret, region us-east-1, output json
   aws sts get-caller-identity   # debe devolver tu cuenta y el usuario
   ```
3. Los emails de alerta y de SNS llegan a tu correo; tendrás que **confirmar** la suscripción de SNS haciendo clic en el email que te envía AWS.

## 2. Bootstrap: estado remoto, presupuesto y rol para GitHub

```bash
cd terraform/bootstrap
terraform init
terraform apply -var alert_email=tu@correo.com
```

Qué crea: bucket `orderly-tfstate-<cuenta>`, presupuesto de 5 USD, proveedor OIDC de GitHub y el rol `orderly-github-deploy`.

Guarda los outputs:

```bash
terraform output backend_hcl > ../envs/dev/backend.hcl   # quita las comillas del heredoc si las tiene
terraform output github_deploy_role_arn
```

`backend.hcl` queda fuera de git. Debe verse así:

```hcl
bucket       = "orderly-tfstate-123456789012"
key          = "envs/dev/terraform.tfstate"
region       = "us-east-1"
use_lockfile = true
```

## 3. Primer despliegue del entorno dev (sin la Lambda de imagen)

El indexer necesita que la imagen ya esté en ECR, y ECR lo crea este mismo apply. Por eso el primer apply va con `deploy_indexer=false`.

```bash
cd ../..                 # raíz del repo
pnpm install && pnpm build

cd terraform/envs/dev
terraform init -backend-config=backend.hcl
terraform plan  -var notification_email=tu@correo.com -var deploy_indexer=false
terraform apply -var notification_email=tu@correo.com -var deploy_indexer=false
```

Lee el plan antes del `yes`: verás ~70 recursos (Cognito, tabla, bus, colas, 7 Lambdas, API...).
Al terminar, confirma la suscripción de SNS desde tu correo.

## 4. Subir la imagen del indexer y completar el despliegue

```bash
cd ../../..   # raíz
scripts/push-image.sh "$(terraform -chdir=terraform/envs/dev output -raw ecr_repository_url)" latest
cd terraform/envs/dev
terraform apply -var notification_email=tu@correo.com
```

Ahora sí existe `orderly-dev-search-indexer` apuntando al digest de la imagen `latest`.

## 5. Usuarios de prueba y smoke test

```bash
cd ../../..
scripts/create-user.sh admin@example.com 'Admin-Pass-123!' admin
scripts/create-user.sh cliente@example.com 'Cliente-Pass-123!' customer

export ADMIN_TOKEN=$(scripts/get-token.sh admin@example.com 'Admin-Pass-123!')
export CUSTOMER_TOKEN=$(scripts/get-token.sh cliente@example.com 'Cliente-Pass-123!')
scripts/smoke.sh
```

El smoke test crea un producto, hace un pedido que se confirma, otro que se rechaza por falta de stock,
verifica el 403 del customer al crear productos y lista los pedidos. Te llegará un email de SNS por el pedido confirmado.

Para mirar qué pasó por dentro:

```bash
# Todos los eventos del bus, en orden
aws logs tail /aws/events/orderly-dev --since 10m
# Logs de una Lambda
aws logs tail /aws/lambda/orderly-dev-orders-reserve-stock --since 10m
# ¿Hay algo en las DLQ?
aws sqs get-queue-attributes --queue-url "$(terraform -chdir=terraform/envs/dev output -json dlq_urls | jq -r .inventory)" --attribute-names ApproximateNumberOfMessages
```

## 6. Encender OpenSearch (cuando quieras probar la búsqueda)

```bash
cd terraform/envs/dev
terraform apply -var notification_email=tu@correo.com -var enable_opensearch=true   # tarda ~15 min
cd ../../..
# Reindexar lo que ya existe en DynamoDB (los eventos anteriores se descartaron al estar apagado)
TABLE_NAME=orderly-dev OPENSEARCH_URL=$(terraform -chdir=terraform/envs/dev output -raw opensearch_endpoint) OPENSEARCH_AUTH=sigv4 pnpm reindex
curl -s "$(terraform -chdir=terraform/envs/dev output -raw api_url)/products/search?q=zapato" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq
```

Y **apágalo el mismo día**:

```bash
terraform -chdir=terraform/envs/dev apply -var notification_email=tu@correo.com -var enable_opensearch=false
```

## 7. GitHub Actions

En el repo, Settings → Secrets and variables → Actions → **Variables** (no secrets; nada aquí es secreto):

| Variable | Valor |
|---|---|
| `AWS_ROLE_ARN` | output `github_deploy_role_arn` del bootstrap |
| `AWS_REGION` | `us-east-1` |
| `TF_STATE_BUCKET` | output `state_bucket` del bootstrap |
| `NOTIFICATION_EMAIL` | tu correo |
| `ENABLE_OPENSEARCH` | `false` |

O por CLI: `gh variable set AWS_ROLE_ARN --body "arn:aws:iam::...:role/orderly-github-deploy"`.

Desde entonces: cada PR corre lint, tests, validate y comenta el `terraform plan`; cada push a `main` construye, sube la imagen y aplica.

## 8. Destruir todo

```bash
terraform -chdir=terraform/envs/dev destroy -var notification_email=tu@correo.com
# El bootstrap puede quedarse (no cuesta nada); si quieres borrarlo, vacía el bucket primero:
aws s3 rm s3://orderly-tfstate-<cuenta> --recursive
terraform -chdir=terraform/bootstrap destroy -var alert_email=tu@correo.com
```

## Problemas típicos

- **`terraform init` pide backend**: falta `backend.hcl` o no pasaste `-backend-config`.
- **`data.aws_ecr_image` no encuentra la imagen**: aún no hiciste `push-image.sh`, o aplica con `-var deploy_indexer=false`.
- **401 en la API**: el token expiró (60 min) o estás usando el access token en vez del ID token. `get-token.sh` devuelve el ID token.
- **El pedido se queda en PENDING**: revisa `/aws/events/orderly-dev` (¿llegó OrderPlaced?), luego los logs de `outbox-relay` y `reserve-stock`, y la DLQ.
- **No llega el email**: la suscripción SNS está sin confirmar; búscalo en spam.
