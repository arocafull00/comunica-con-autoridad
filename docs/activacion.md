# Configuración, despliegue y comprobaciones

Esta guía describe cómo preparar un entorno. Los triggers, horarios, condiciones, reintentos y estado comprobado de producción se mantienen únicamente en [triggers.md](triggers.md). Las migraciones crean los cron de envío pausados; eso no describe el estado actual de producción.

## Desarrollo local

Requisitos: Node.js 24, pnpm 10 y Docker con el motor Linux arrancado. Supabase CLI y Deno son dependencias de desarrollo.

```powershell
pnpm install
pnpm exec supabase start
```

Puertos: API `55321`, Postgres `55322`, Studio `55323` y correo local `55324`. Para iniciar menos servicios:

```powershell
pnpm exec supabase start -x studio,imgproxy,inbucket,storage-api,realtime,logflare,vector,supavisor
```

Copiar `.env.example` a `.env.local`, usar las credenciales del Supabase **local** obtenidas con `pnpm exec supabase status` y generar un secreto HMAC de al menos 32 caracteres para `LEAD_IP_HMAC_SECRET`. No compartir ni versionar claves. Iniciar la web con `pnpm dev`.

Fuera de Vercel, el servidor ignora las cabeceras de IP y aplica un límite compartido de desarrollo. Un despliegue público en otro hosting requiere configurar una fuente de IP confiable.

## Supabase remoto y Vercel

1. Elegir el proyecto de esta web; requiere PGMQ, Cron, pg_net y Vault. Vincularlo con `pnpm exec supabase link --project-ref REFERENCIA`.
2. Revisar `pnpm exec supabase migration list` y `pnpm exec supabase db push --linked --dry-run`. Aplicar las migraciones pendientes con `pnpm exec supabase db push --linked`. **Nunca modificar una migración anterior**: cada cambio SQL necesita otra nueva.
3. Configurar en el servidor de Vercel `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_SITE_URL` y `LEAD_IP_HMAC_SECRET`. No usar `NEXT_PUBLIC_`. Mantener el HMAC estable entre instancias.
4. Configurar los webhooks y el secreto de baja descritos abajo y publicar Next.js. Preparar cuentas privadas siguiendo [administración](administracion.md).

Las tablas de contactos y las RPC se consultan desde el servidor con permisos privilegiados; `private` y `pgmq` no se exponen en la Data API. La API devuelve `503` si no puede confirmar la persistencia.

Google Sheets usa por defecto el Apps Script de `reference/template.html`; `GOOGLE_SHEETS_ENDPOINT` permite cambiarlo. La copia se hace al completar el segundo formulario. El contrato y los reintentos se explican en [formulario de la masterclass](formulario-masterclass.md).

## Webhooks en Next.js

| Proveedor | Endpoint público | Variables del servidor | Configuración |
| --- | --- | --- | --- |
| Cal.com | `/api/webhooks/cal` | `CAL_WEBHOOK_SECRET`, `CAL_EVENT_SLUG` | Webhook del tipo de evento `sesion-gratuita-comunicacion`, sin plantilla personalizada; suscribir `BOOKING_CREATED`, `BOOKING_RESCHEDULED` y `BOOKING_CANCELLED`. Usar el mismo secreto de al menos 32 caracteres en ambos lados. |
| Meta | `/api/webhooks/whatsapp` | `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Configurar callback HTTPS, validar el GET challenge, suscribir `messages` y suscribir la WABA del número real a la aplicación correcta. |
| Baja de correo | `/api/followups/unsubscribe` | `EMAIL_UNSUBSCRIBE_SECRET` | Usar exactamente el mismo secreto que en la Edge Function; el GET muestra la confirmación y el POST procesa la baja. |

El receptor de Cal.com verifica `X-Cal-Signature-256` sobre el cuerpo original. Meta verifica `X-Hub-Signature-256` y filtra el número configurado. No confundir el número real con el sandbox. Un challenge correcto o una suscripción guardada no prueban que lleguen respuestas: verificar recepción y persistencia con un contacto autorizado. El comportamiento de cada evento está en [triggers.md](triggers.md#triggers-que-cambian-o-detienen-envíos).

## Servicio de envío en Supabase

Usar `supabase/functions/.env.example` como referencia. Guardar las variables en un archivo privado ignorado por Git y cargarlas con `pnpm exec supabase secrets set --env-file RUTA_PRIVADA`.

| Canal | Secrets requeridos |
| --- | --- |
| Correo | `FOLLOWUP_EMAIL_SEND_ENABLED`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_SITE_URL` y `EMAIL_UNSUBSCRIBE_SECRET` (al menos 32 caracteres). El remitente necesita un dominio verificado y las cuatro plantillas publicadas. |
| WhatsApp real | `FOLLOWUP_WHATSAPP_SEND_ENABLED`, `FOLLOWUP_WHATSAPP_TEST_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` y `WHATSAPP_GRAPH_API_VERSION` (`vNN.N`). El token necesita permisos para leer plantillas y enviar desde el número configurado. |

Supabase proporciona `SUPABASE_URL` y `SUPABASE_SECRET_KEYS`; no copiarlos como secrets personalizados. Las variables de Vercel no se transfieren automáticamente a Supabase.

Para desplegar el procesador:

```powershell
pnpm exec supabase functions deploy process-followup-queue
```

Utiliza `verify_jwt=false` y `withSupabase({ auth: "secret" })`: exige la clave privada `default` en la cabecera `apikey`. Rechaza claves públicas y JWT de usuario. No invocar el worker como una comprobación inocua: puede procesar trabajos pendientes y enviar mensajes.

En Supabase Vault configurar `followup_project_url` (URL base HTTPS del proyecto) y `followup_worker_secret_key` (clave privada `default`, `sb_secret_...`). Para modificar secretos existentes usar `vault.update_secret`; no incluir valores en migraciones ni en el texto de Cron. Los antiguos `followup_site_url`, `followup_cron_secret`, `followup_worker_service_role_jwt` y `FOLLOWUP_CRON_SECRET` ya no se usan.

Activar o pausar el cron mediante SQL administrativo, después de revisar configuración, plantillas y trabajos pendientes:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'process-followup-queue'),
  active := true
);
-- Para pausar, ejecutar con active := false.
```

Los interruptores y requisitos efectivos de cada canal están en [triggers.md](triggers.md). El panel es de consulta y no activa envíos. El cron antiguo `process-whatsapp-queue` pertenece a la bienvenida de clientes antiguos de `POST /api/leads`, no al flujo de masterclass; mantenerlo pausado para este flujo.

El catálogo se actualiza automáticamente en el worker. Para sincronizarlo de forma puntual sin enviar ni activar canales:

```powershell
node --env-file=.env.local scripts/sync-followup-templates.mjs
```

La edición y publicación de correos se mantiene en [templates/README.md](../templates/README.md).

## Flujo de reserva con audios

Las migraciones `20261014000100` y `20261014000200` se aplican con el resto (`pnpm exec supabase db push`). El flujo queda **desactivado** hasta ejecutar su interruptor; mientras tanto todas las reservas siguen con los mensajes anteriores.

1. Publicar la web: sirve `public/primer-audio-reserva.m4a` y `segundo-audio-reserva.m4a` (AAC, `audio/mp4`). El worker los descarga con `ADMIN_SITE_URL`, los sube a Meta y los envía por su id. Meta no entregaba las copias OGG/Opus (error 131053). `ADMIN_SITE_URL` debe ser el dominio público de la web.
2. Desplegar `process-followup-queue` (comando anterior).
3. Plantillas de Meta, mismo número y cuenta: `reserva_recibida_ok` (botón OK) y `reserva_confirmar_asistencia` (botón CONFIRMAR), ambas `es` y UTILITY, enviadas a revisión el 14/10/2026 ([definición](../templates/whatsapp-booking-audio.json)). El worker sincroniza el catálogo cada minuto; comprobar que figuran `APPROVED` en el panel de WhatsApp.
4. Activar con SQL administrativo. Se rechaza si alguna de las dos plantillas no está aprobada:

```sql
select public.set_booking_audio_flow(true);
-- Para volver a los mensajes anteriores en nuevas reservas: select public.set_booking_audio_flow(false);
```

El flujo se decide al programar cada reserva o reprogramación; cambiar el interruptor no modifica los trabajos ya creados. Una prueba real de recepción (botones, audios y respuestas por el webhook) es independiente de las pruebas automáticas y debe hacerse con un teléfono propio tras activar.

**Vídeo de casos de éxito.** Pendiente de grabar. Cuando exista, se añadirá como un paso más tras el OK solo para envíos futuros; no se enviará de forma retroactiva.

## Sandbox de WhatsApp

El sandbox necesita los cuatro secrets `WHATSAPP_TEST_ACCESS_TOKEN`, `WHATSAPP_TEST_PHONE_NUMBER_ID`, `WHATSAPP_TEST_GRAPH_API_VERSION` y `WHATSAPP_TEST_RECIPIENT`. El emisor debe ser el número de prueba de Meta `+1 555…` y el destinatario debe estar verificado. El token temporal puede caducar.

`test-whatsapp` envía una única plantilla `hello_world` sin consumir la cola. Desplegar con `pnpm exec supabase functions deploy test-whatsapp`; cada POST autenticado con la clave privada `default` es un **nuevo envío real al destinatario de pruebas**. No reintentar resultados inciertos automáticamente.

Para probar la cola, usar `FOLLOWUP_WHATSAPP_TEST_ENABLED=true` y el operador privado con un archivo que contenga el destinatario autorizado:

```powershell
node --env-file=.env.local --env-file=RUTA_PRIVADA scripts/whatsapp-followup-test.mjs enable
node --env-file=.env.local --env-file=RUTA_PRIVADA scripts/whatsapp-followup-test.mjs status
node --env-file=.env.local --env-file=RUTA_PRIVADA scripts/whatsapp-followup-test.mjs advance UUID_DEL_TRABAJO
node --env-file=.env.local --env-file=RUTA_PRIVADA scripts/whatsapp-followup-test.mjs disable
```

El modo de pruebas impide cargar el canal real. Solo los nuevos trabajos del teléfono autorizado se marcan como prueba, no se incorporan inscripciones anteriores ni se reinician secuencias. Usa un email nuevo y el mismo email en Cal.com; deja el consentimiento de email desmarcado si solo pruebas WhatsApp. Los trabajos de prueba permanecen excluidos del canal real después de deshabilitar el modo. Los plazos y diferencias de contenido se recogen en [triggers.md](triggers.md).

## Validación y monitorización

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

`test:db` exige localhost y limita la limpieza a sus filas de prueba. `test:worker` simula proveedores. `test:browser` intercepta la API; `test:browser:local` usa build, API y Supabase locales, simula Meta y sustituye Apps Script por un servidor en `3102`. Ambas suites de navegador usan `3100` y deben ejecutarse sucesivamente. Ninguna prueba simulada acredita entrega a un destinatario real.

En producción, revisar `cron.job`, las respuestas HTTP en `net._http_response`, los contadores del worker y `followup_jobs`; la consulta de fechas y el significado de los estados están en [triggers.md](triggers.md#comprobar-fechas-concretas). Revisar `delivery_unknown` manualmente antes de considerar un reenvío. Las próximas llamadas se consultan en `/admin/calls`; cancelar desde Cal.com para que el webhook retire sus avisos.

El endpoint antiguo `POST /api/leads` conserva su contrato: JSON de hasta 8192 bytes, `Idempotency-Key` UUID, honeypot vacío, normalización de email/móvil y respuestas `201` al crear, `200` al repetir y `409` ante conflicto. Puede devolver `400`, `413`, `415`, `429` con `Retry-After` o `503`. El formulario actual usa los dos endpoints descritos en la guía de masterclass.
