# Configuración y activación

El flujo de webinar, webhooks de Cal.com, respuestas WhatsApp y emails con Resend se configura en [seguimiento](seguimiento.md). Sus envíos tienen interruptores separados y empiezan desactivados.

El código guarda solicitudes en Supabase y replica los datos en el Apps Script de Google Sheets que utiliza el HTML de referencia. La integración de WhatsApp y su Cron permanecen desactivados hasta completar esta guía.

## Desarrollo y pruebas locales

Requisitos: Node.js 24, pnpm 10 y Docker con su motor Linux arrancado. Supabase CLI y Deno se incluyen como dependencias de desarrollo; no hace falta instalarlos globalmente.

```powershell
pnpm install
pnpm exec supabase start
```

Este proyecto utiliza API `55321`, Postgres `55322`, Studio `55323` y correo local `55324` para convivir con otros proyectos Supabase. Para iniciar menos servicios:

```powershell
pnpm exec supabase start -x studio,imgproxy,inbucket,storage-api,realtime,logflare,vector,supavisor
```

Copiar `.env.example` a `.env.local`. Obtener la URL y la clave **service_role JWT** del Supabase local mediante `pnpm exec supabase status`. Generar un secreto HMAC propio con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y guardar su valor en `LEAD_IP_HMAC_SECRET`. No compartir ni versionar las claves.

Google Sheets utiliza por defecto el destino de `reference/template.html`. Para cambiarlo, configurar `GOOGLE_SHEETS_ENDPOINT` en el servidor. Cada envío conserva `submission_id`, `nombre`, `a_que_te_dedicas`, `situacion_actual`, `que_quiere_mejorar`, `email`, `telefono`, `telefono_pais` y `telefono_prefijo`. El servidor verifica la respuesta JSON de Apps Script; un fallo devuelve `503` con un aviso de que el contacto ya está guardado en Supabase. El reintento conserva el identificador, y una respuesta `success: true` con `duplicate: true` se acepta como confirmación de la copia existente.

```powershell
pnpm dev
```

Fuera de Vercel, las cabeceras de IP se ignoran y se aplica un único límite compartido para desarrollo. No utilizar esta configuración de IP como despliegue público fuera de Vercel sin añadir una fuente de IP confiable para ese entorno.

Comprobaciones reproducibles:

```powershell
pnpm test
pnpm test:worker
pnpm test:db
pnpm lint
pnpm typecheck
pnpm check:worker
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:browser:local
```

`test:db` solo admite conexiones de localhost y utiliza transacciones con rollback o limpieza limitada a sus propias filas. Ejecutarlo sobre la base local de este proyecto, sin otros workers activos. `test:browser` intercepta la API para probar UX, fallos y reintentos en escritorio y móvil. `test:browser:local` utiliza el build de producción, la API real y Supabase local; carga las credenciales locales en memoria, nunca llama a Meta y sustituye Apps Script por un servidor local de prueba en `3102` para no escribir datos de pruebas en la hoja real. Ambas suites de navegador utilizan el puerto `3100` y deben ejecutarse sucesivamente.

Las pruebas del worker simulan Meta; no demuestran entrega a un teléfono real.

También se puede comprobar la autenticación del worker contra el runtime local. En una terminal, ejecutar `pnpm exec supabase functions serve process-whatsapp-queue --env-file supabase/functions/.env.example` y, en otra, `pnpm check:worker:local`. Comprueba que el gateway rechaza peticiones sin credencial, que el worker rechaza el JWT anónimo y que un service_role válido recibe `503` porque los envíos están desactivados. No consume trabajos ni llama a Meta.

## Supabase remoto y Vercel

1. Crear o elegir el proyecto Supabase destinado a esta web. Requiere Postgres con PGMQ, Cron, pg_net y Vault disponibles; no reutilizar bases ajenas sin revisar el destino.
2. Iniciar sesión en Supabase CLI y vincular el proyecto mediante `pnpm exec supabase link --project-ref <REFERENCIA>`. Revisar `pnpm exec supabase migration list` y `pnpm exec supabase db push --linked --dry-run` antes de aplicar `pnpm exec supabase db push --linked`.
3. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_SITE_URL` y `LEAD_IP_HMAC_SECRET` en las variables **del servidor** de Vercel. Nunca usar el prefijo `NEXT_PUBLIC_`. Mantener el secreto HMAC estable entre instancias del mismo entorno. Preparar el acceso privado siguiendo [administración](administracion.md).
4. Desplegar Next.js en Vercel. Con la configuración ausente o inaccesible, la API devuelve `503`; no confirma solicitudes no guardadas.
5. Antes de publicar, configurar el aviso de privacidad del responsable real y su política publicada. El formulario mínimo no inventa razón social, domicilio ni textos jurídicos. La casilla WhatsApp autoriza exclusivamente una confirmación, no campañas posteriores.

Las migraciones activan RLS y revocan acceso a visitantes y usuarios autenticados. Las tablas y RPCs se usan exclusivamente desde el servidor con credenciales privilegiadas. Las funciones de cola solo permiten operar sobre `whatsapp_outbound`; `private` y `pgmq` no se exponen en la Data API.

## Meta y plantilla

Configurar la cuenta de WhatsApp Business, su número y un token de sistema con permiso de mensajería. Crear y obtener aprobación para una plantilla con un único parámetro de texto en el cuerpo, sin cabecera ni botones que requieran parámetros:

> Hola {{1}}, hemos recibido tu solicitud en Comunica con Autoridad. Nos pondremos en contacto contigo próximamente.

Nombre previsto: `comunica_bienvenida`; idioma previsto: `es`. Utilizar exactamente el nombre e idioma aprobados. Elegir explícitamente una versión vigente de Graph API; el proyecto no presupone una versión futura ni envía una plantilla de ejemplo de Meta.

Copiar `supabase/functions/.env.example` a un archivo de secretos ignorado por Git y rellenarlo fuera del repositorio:

- `WHATSAPP_SEND_ENABLED=false` mientras se configura.
- `WHATSAPP_ACCESS_TOKEN`: token de Meta.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número, no el número de teléfono.
- La plantilla e idioma se seleccionan en `/admin/whatsapp` tras sincronizar el catálogo completo, con sus estados de Meta. Solo las aprobadas y compatibles se pueden guardar para la bienvenida; ver [administración](administracion.md). Ya no son variables del worker.
- `WHATSAPP_GRAPH_API_VERSION`: versión explícita, con formato `vNN.N`.

```powershell
pnpm exec supabase secrets set --env-file supabase/functions/.env.local
pnpm exec supabase functions deploy process-whatsapp-queue
```

Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` al worker. Esta implementación conserva `verify_jwt = true` y exige adicionalmente la credencial de servicio exacta. Para invocarlo se necesita la **clave legacy service_role en formato JWT** del mismo proyecto; una clave `sb_secret_...`, una publishable key o un JWT de usuario no sustituye este Bearer.

## Prueba real y activación de Cron

1. Mantener Cron apagado y revisar los mensajes `pending` acumulados: al activar, también podrán enviarse las bienvenidas de esas solicitudes con consentimiento. Resolver registros de prueba o antiguos antes de habilitar envíos.
2. Seleccionar una plantilla aprobada y activar los envíos en `/admin/whatsapp`. Configurar `WHATSAPP_SEND_ENABLED=true` y sus secretos completos únicamente cuando plantilla y número estén listos. Crear una solicitud de prueba con consentimiento usando un teléfono propio autorizado.
3. Invocar manualmente la Edge Function mediante POST con `Authorization: Bearer <SERVICE_ROLE_JWT>` en una herramienta privada. Confirmar que el mensaje llega y que Postgres registra `sent`, `provider_message_id` y `sent_at`. La función puede procesar hasta diez registros pendientes, no solo el de prueba.
4. Guardar en **Supabase Vault**, sin incluir los valores en migraciones, `whatsapp_project_url` con la URL del proyecto y `whatsapp_worker_service_role_jwt` con su service_role JWT. La credencial no aparecerá en el SQL de Cron.
5. Activar exclusivamente el job de este proyecto desde SQL administrativo:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'process-whatsapp-queue'),
  active := true
);
```

Cron invoca el worker cada 30 segundos. Cada lectura tiene visibilidad de 120 segundos y el envío HTTP tiene timeout de diez segundos. Dos leases en Postgres limitan los envíos simultáneos entre ejecuciones solapadas. El nombre, idioma y versión de API quedan fijados al reclamar cada mensaje y se mantienen en sus reintentos.

## Estados, incidencias y revisión manual

- `pending`: en cola, inicialmente o esperando un reintento.
- `processing`: reclamado por un worker. Se incrementa `attempts` al reclamarlo.
- `sent`: Meta aceptó la petición y devolvió su identificador; no acredita entrega ni lectura.
- `failed`: error permanente, tres intentos agotados, consentimiento retirado o resultado incierto.

Los rechazos transitorios confirmados por Meta se reintentan tras 60 y 300 segundos; los demás errores confirmados terminan el trabajo. Los timeouts, errores de red o respuestas ambiguas se detienen con `last_error = 'delivery_unknown'`. Si un worker se interrumpe, una lectura posterior convierte su reclamación caducada en ese mismo estado. Si Meta aceptó el envío pero falló la escritura del resultado, no se reenvía automáticamente.

`UNIQUE(lead_id, sequence)` y las reclamaciones atómicas evitan duplicaciones internas habituales, pero no ofrecen entrega exactamente una vez entre Postgres y Meta. Los trabajos terminados se archivan en `pgmq.a_whatsapp_outbound`; sus payloads contienen solo el identificador del mensaje.

Consultar incidencias en Supabase mediante:

```sql
select id, lead_id, status, attempts, last_error, scheduled_at, sent_at
from public.whatsapp_messages
where status in ('failed', 'processing')
order by created_at desc;
```

No resetear ni reenviar `delivery_unknown` a ciegas. Primero revisar la evidencia disponible en Meta y el consentimiento actual; sin evidencia suficiente, mantenerlo detenido. Esta versión no incorpora webhook ni botón de replay. Cualquier replay administrativo deberá ser deliberado y crear un nuevo trabajo para el mismo mensaje, una vez comprobado que no habrá duplicación.

Los logs del worker muestran contadores y errores genéricos; nunca nombres, teléfonos, tokens ni respuestas completas del proveedor. Revisar también las respuestas HTTP de `pg_net`: que Cron ejecute el SQL no demuestra que la función haya terminado correctamente. Los registros de rate limiting caducan al día y el historial de Cron se limpia a los siete días; esas dos tareas de mantenimiento quedan activas, independientemente del Cron de envíos.

Para detener envíos, desactivar primero el Cron y después `WHATSAPP_SEND_ENABLED`. Una ejecución en curso puede finalizar; los leads seguirán guardándose y los trabajos permanecerán pendientes. Las migraciones aplicadas no se editan: cualquier cambio posterior requiere una nueva migración.

## Contrato de la API

`POST /api/leads`, con `Content-Type: application/json` y `Idempotency-Key: <UUID>`. Cuerpo máximo de 8192 bytes:

```json
{
  "name": "Adrián",
  "phone": "+34612345678",
  "email": "adrian@example.com",
  "whatsappConsent": false,
  "website": ""
}
```

La API normaliza el teléfono y el email antes de comparar peticiones repetidas. Devuelve `201` al crear, `200` al repetir los mismos datos y `409` al reutilizar la clave con datos diferentes. Una repetición ya guardada no consume el límite de cinco solicitudes nuevas por diez minutos. Cambiar contenido en el formulario genera una nueva clave; reintentar el mismo contenido conserva la existente mientras permanezca abierta la página.

El honeypot debe estar vacío. Se devuelven `400` con `fieldErrors` para datos inválidos, `413` para cuerpos demasiado grandes, `415` para otro tipo de contenido, `429` con `Retry-After` para exceso de solicitudes y `503` cuando no puede confirmarse la persistencia. Ninguna respuesta expone datos del lead ni detalles internos de Supabase.

Referencias: [Supabase Queues](https://supabase.com/docs/guides/queues/pgmq), [Cron y Vault](https://supabase.com/docs/guides/functions/schedule-functions), [política de WhatsApp Business](https://whatsappbusiness.com/policy/), [cabeceras de Vercel](https://vercel.com/docs/headers/request-headers).

La web también incluye Vercel Web Analytics y atribución UTM opcional. La nueva migración permite consultar solicitudes, correos distintos y campañas mediante una función reservada a administración. Ver [la guía de analíticas](analiticas.md) para activar el colector y consultar esos informes. WhatsApp sigue siendo opcional y su Cron conserva su estado anterior.
