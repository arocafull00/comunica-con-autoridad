# Inscripción al webinar y reserva de llamada

El encargo del cliente, sus textos originales y las diferencias pendientes están documentados en [automatizaciones-cliente.md](automatizaciones-cliente.md).

La inscripción se registra cuando se guardan WhatsApp y email, se confirma la copia en Google Sheets y el servidor concede acceso al vídeo. Las cuatro preguntas para reservar se guardan después, en la misma inscripción (ver `formulario-masterclass.md`). No se exige reproducir o terminar el vídeo. La marca de acceso de localStorage no inscribe contactos antiguos automáticamente.

`POST /api/leads` guarda por separado el consentimiento opcional de WhatsApp y el de comunicaciones por email, con fecha y versión del texto. Las casillas empiezan desmarcadas. La falta de permiso no impide acceder al vídeo. Cada email admite baja; WhatsApp admite `BAJA` y `STOP`.

Una dirección de email entra una sola vez en el webinar. Los reintentos conservan la fecha inicial y los trabajos; volver a registrarse con otro identificador no reinicia los mensajes. La reserva se relaciona por el email del titular, normalizado a minúsculas: debe usar el mismo email en Cal.com. Una reserva con otro email queda guardada sin asociar y no genera mensajes hasta que ese email complete el formulario.

## Secuencia

| Evento | Canal | Momento | Condición |
| --- | --- | --- | --- |
| Formulario completo | WhatsApp | +1 hora | Permiso y ninguna reserva registrada |
| Formulario completo | WhatsApp | +1 día | Permiso y ninguna reserva registrada |
| Formulario completo | WhatsApp | +3 días | Permiso, ninguna reserva y ninguna respuesta por WhatsApp |
| Formulario completo | Resend | +30 minutos, +1, +2 y +3 días | Permiso de comunicaciones; continúa si reserva |
| Reserva en Cal.com | WhatsApp | Inmediato | Confirmación habitual con ≥24h; variante corta entre 2 y <24h |
| Llamada | WhatsApp | −24 horas, −2 horas y −15 minutos | Permiso y reserva vigente |

Los originales de email están en `public.followup_steps` y `lib/followups/messages.json`; WhatsApp usa el contenido actual de sus plantillas fijas en Meta. Los dos emails rotulados «Email 4» en el documento corresponden a los pasos 3 y 4. Las cancelaciones por falta de confirmación se revisan manualmente, aunque el texto aprobado de Meta mencione liberación de plazas. Los mensajes son fijos y no se pueden editar o seleccionar en el panel. El original conserva la discrepancia Mateo/Álvaro y 35/45 minutos: revisar estos detalles de contenido antes de activar.

No se recuperan recordatorios cuyo momento ya pasó al reservar. Con menos de dos horas de antelación solo se programa el recordatorio de 15 minutos, si su momento todavía no ha pasado; no se envía confirmación inmediata ni el recordatorio de dos horas. El resto de pasos queda `suppressed` con `not_needed_short_notice` y se muestra como «No ha hecho falta». Entre dos y menos de 24 horas se envía `booking_short_notice` en lugar de `booking_confirmation`. Los pasos de la otra variante y los horarios ya pasados se conservan como descartados, sin duplicar mensajes. Los recordatorios tienen una tolerancia máxima de 30 minutos y siempre caducan antes de empezar la llamada; los de webinar y emails caducan 6 horas después de su fecha. Un sistema pausado no enviará de golpe una secuencia antigua al reactivarse.

`CONFIRMO` permanece pausado en el receptor de WhatsApp: la respuesta se registra con `confirms: false`. El código de detección está comentado para una futura iteración. La lógica interna conservada solo registra asistencia cuando el teléfono tiene una única reserva futura asociada y la respuesta es posterior a su creación o cambio, pero actualmente el receptor no la activa. Si hay varias llamadas futuras para ese teléfono o una respuesta llega antes de su webhook, la respuesta queda registrada para revisión; no se confirman varias llamadas por inferencia. No se cancelan llamadas por falta de respuesta. Cancelarlas manualmente en Cal.com retira los recordatorios al recibir su webhook. Después de una cancelación no se reinicia automáticamente la secuencia de captación.

## Cal.com

Crear un webhook **del tipo de evento** `sesion-gratuita-comunicacion`, sin plantilla personalizada, apuntando a:

```text
https://TU-DOMINIO/api/webhooks/cal
```

Suscribir `BOOKING_CREATED`, `BOOKING_RESCHEDULED` y `BOOKING_CANCELLED`. Configurar el mismo secreto aleatorio de al menos 32 caracteres en Cal.com y en `CAL_WEBHOOK_SECRET` del servidor. El receptor comprueba `X-Cal-Signature-256` sobre el cuerpo original. `CAL_EVENT_SLUG` permite restringir otro tipo de sesión.

La fecha `createdAt` ordena los eventos por reserva; los duplicados y eventos anteriores no restauran una cita cancelada. En una reprogramación, `payload.uid` identifica la nueva reserva y `payload.rescheduleUid` la anterior. Se conservan las reservas sin contacto para relacionarlas cuando llegue el registro. Para Google Meet se lee `metadata.videoCallUrl` o una URL HTTPS en `location`. El recordatorio de 2 horas espera a disponer de enlace y caduca si no llega; nunca incluye un placeholder vacío. La hora del recordatorio utiliza la zona horaria del asistente.

Documentación del proveedor: [webhooks de Cal.com](https://github.com/calcom/help/blob/main/webhooks.mdx).

## WhatsApp

**Decisión del 9 de octubre de 2026:** la configuración adicional de webhooks de WhatsApp queda aplazada. El propósito, el código preparado, el estado observado en Meta y los pasos para retomarla están en [whatsapp-webhooks-pendientes.md](whatsapp-webhooks-pendientes.md). Las indicaciones del siguiente párrafo quedan como referencia para esa futura implementación.

Configurar el webhook de Meta en `https://TU-DOMINIO/api/webhooks/whatsapp` y suscribir `messages`. Next.js necesita `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`. El GET valida el challenge; los POST validan `X-Hub-Signature-256` y solo admiten el número de negocio configurado. Los identificadores de mensajes evitan procesar dos veces una respuesta. Las notificaciones de estado no cuentan como respuestas.

Las ocho asociaciones son fijas en `lib/followups/whatsapp-automations.ts` y en `20261009190000_fixed_meta_whatsapp_templates.sql`. El contenido se consulta en Meta; no se exige que coincida con `followup_steps.body` ni con `messages.json`.

| Trigger | Plantilla fija en Meta | Idioma de Meta | Variable |
| --- | --- | --- | --- |
| Confirmación de reserva | `whatsapp_confirmacion_reserva` | `es` | Ninguna; incluye imagen |
| Reserva entre 2 y menos de 24h | `reserva_menos_24hantes` | `en` | Ninguna; incluye imagen |
| Recordatorio −24h | `recordatorio_24hantes` | `en` | Ninguna |
| Recordatorio −2h | `recordatorio_reunion_2h` | `es` | `{{1}}`: enlace real de Meet |
| Recordatorio −15m | `15_minutos_antes` | `en` | Ninguna |
| Seguimiento +1h | `seguimiento_webinar_1h` | `es` | `{{1}}`: nombre o «comunicador/a» |
| Seguimiento +1 día | `no_reservan_1dia_despues` | `es` | Ninguna; botón con URL fija |
| Seguimiento +3 días | `seguimiento_no_reserva_3dia` | `en` | Ninguna |

El idioma `en` es el identificador real registrado en Meta para algunas plantillas cuyo texto está en español. Se conserva tal cual. Las imágenes se envían mediante el enlace de la cabecera que proporciona el catálogo de Meta; los botones con URL fija y los pies los resuelve Meta sin parámetros adicionales.

El worker `process-followup-queue` consulta el catálogo completo y actualiza estados y contenido en cada ejecución del cron, incluso con los envíos pausados. Necesita los secretos de Supabase `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID` y `WHATSAPP_GRAPH_API_VERSION`, con permiso para leer plantillas. Una consulta fallida conserva el catálogo anterior y pausa WhatsApp durante esa ejecución, mientras continúa procesando email. El dashboard muestra el último catálogo sincronizado y no permite sincronizar, editar, escoger plantillas ni activar o desactivar envíos.

Para una actualización operativa puntual existe `node --env-file=.env.local scripts/sync-followup-templates.mjs`: consulta el catálogo completo sin mapas configurables, envíos ni activación. Para habilitar los envíos reales el servicio requiere `WHATSAPP_PHONE_NUMBER_ID`, `FOLLOWUP_WHATSAPP_SEND_ENABLED=true`, `FOLLOWUP_WHATSAPP_TEST_ENABLED=false`, `whatsapp_settings.enabled=true` y el cron activo. Estas opciones se gestionan operativamente fuera del dashboard. Solo los pasos cuya plantilla esté `APPROVED` en Meta pueden enviarse; los pendientes esperan dentro de su horario válido. La bienvenida antigua no se genera además de estos seguimientos.

## Prueba de conexión con el número gratuito de Meta

La función privada `test-whatsapp` permite enviar `hello_world` (`en_US`) desde el número de prueba de Meta a un único destinatario verificado. Puede utilizarse con la web publicada en producción: el emisor sigue siendo el número de prueba. No activa los canales automáticos, reclama trabajos ni modifica las plantillas de los recordatorios.

Configurar únicamente `WHATSAPP_TEST_ACCESS_TOKEN`, `WHATSAPP_TEST_PHONE_NUMBER_ID`, `WHATSAPP_TEST_GRAPH_API_VERSION` y `WHATSAPP_TEST_RECIPIENT` en los secretos de Supabase. El destinatario debe tener formato E.164 y estar autorizado en «Paso 1. Probar» de Meta. El token temporal puede caducar; sustituirlo cuando sea necesario.

Desplegar con `pnpm exec supabase functions deploy test-whatsapp`. Invocar mediante POST a `/functions/v1/test-whatsapp` con la clave privada `default` del proyecto en la cabecera `apikey`. La autenticación se realiza mediante el mismo wrapper de Supabase que utiliza el seguimiento; las claves públicas y los JWT de usuario se rechazan. El cliente no puede cambiar el destinatario ni el contenido mediante el cuerpo de la petición.

Antes de enviar, la función consulta el identificador y número emisor en Meta y exige un número de su entorno de pruebas `+1 555…`. Utiliza la misma función `sendFollowup` que los recordatorios, pero envía la plantilla de ejemplo sin consumir la cola. Cada POST autorizado es una prueba nueva; no reintentar automáticamente un resultado incierto. Un `200` con `outcome: sent` e identificador del proveedor confirma aceptación en Meta. Comprobar también la recepción en el móvil y las respuestas entrantes en el webhook.

La web necesita `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y el `WHATSAPP_PHONE_NUMBER_ID` de prueba en Vercel. Suscribir el campo `messages` y la aplicación correcta a la WABA de prueba. Que Meta valide la URL no prueba la recepción de mensajes; su estado de publicación puede limitar los eventos entrantes. Las plantillas de ejemplo no prueban los textos ni la programación de las ocho plantillas reales.

## Resend y ejecución

### Pruebas de la cola de WhatsApp en producción

Con `FOLLOWUP_WHATSAPP_TEST_ENABLED=true`, el worker periódico usa las cuatro credenciales `WHATSAPP_TEST_*` para procesar la cola de prueba. Verifica el número sandbox en Meta antes de reclamar trabajos. El modo impide cargar las credenciales del canal real aunque su flag esté activado. La configuración privada de la base debe autorizar el mismo destinatario; el worker comprueba también el destinatario, el marcador de prueba y la plantilla antes de enviar.

Usar el operador privado `scripts/whatsapp-followup-test.mjs` con `.env.local` (Supabase) y un archivo privado con `WHATSAPP_TEST_RECIPIENT`:

```powershell
node --env-file=.env.local --env-file=.vercel/whatsapp-test/supabase-test-secrets.env scripts/whatsapp-followup-test.mjs enable
node --env-file=.env.local --env-file=.vercel/whatsapp-test/supabase-test-secrets.env scripts/whatsapp-followup-test.mjs status
node --env-file=.env.local --env-file=.vercel/whatsapp-test/supabase-test-secrets.env scripts/whatsapp-followup-test.mjs advance UUID_DEL_TRABAJO
node --env-file=.env.local --env-file=.vercel/whatsapp-test/supabase-test-secrets.env scripts/whatsapp-followup-test.mjs disable
```

Después de habilitarlo, completar las seis respuestas del formulario público con un email nuevo, el móvil autorizado y consentimiento de WhatsApp. Dejar el consentimiento de email desmarcado si solo se prueba WhatsApp. Los nuevos trabajos WhatsApp de ese teléfono se marcan permanentemente como prueba; el resto de contactos conserva su flujo y horarios. Las inscripciones anteriores no se incorporan ni se reinician automáticamente.

Los tres avisos del formulario se programan a +1, +3 y +5 minutos, con la resolución del cron de un minuto. Una respuesta posterior a la inscripción suprime el tercero; una reserva asociada suprime los tres. Cada envío usa `hello_world`: prueba condiciones y programación, no el contenido ni los parámetros de las ocho plantillas reales. Puede repetir la inscripción con otro email para crear otra secuencia; usar el mismo email en Cal.com para asociar una llamada.

Las llamadas mantienen sus horas reales y las reglas de antelación del flujo fijo; a menos de dos horas no hay confirmación inmediata. `advance` adelanta un trabajo de prueba pendiente y sin intentos a un minuto después, conservando controles de consentimiento, revisión de reserva, cancelación, enlace Meet y comienzo de la llamada. Los trabajos de prueba quedan excluidos del canal real incluso después de pausar este modo. Para pausarlo de inmediato ejecutar `disable`; para apagar también el acceso a Meta, poner `FOLLOWUP_WHATSAPP_TEST_ENABLED=false`. Los envíos ya reclamados pueden terminar. Renovar el token temporal de Meta cuando caduque.

Preparar un remitente con dominio verificado y configurar `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_SITE_URL` (HTTPS público) y `EMAIL_UNSUBSCRIBE_SECRET` (al menos 32 caracteres) en los **secretos de Supabase Edge Functions**. Usar `supabase/functions/.env.example` como referencia y cargar únicamente estos secretos mediante `pnpm exec supabase secrets set --env-file RUTA_PRIVADA`. Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_SECRET_KEYS`; no copiarlos como secretos personalizados.

La web sigue atendiendo los enlaces de baja: conservar `EMAIL_UNSUBSCRIBE_SECRET` en Next.js y usar exactamente el mismo valor en la Edge Function. La firma se comparte entre ambos runtimes para mantener válidos los enlaces existentes. Cada envío utiliza `Idempotency-Key: followup/<id del trabajo>` y un enlace firmado de baja que exige pulsar un botón; un escáner de enlaces no da de baja automáticamente.

Para habilitar emails usar `FOLLOWUP_EMAIL_SEND_ENABLED=true` en Supabase. El canal WhatsApp conserva su interruptor independiente `FOLLOWUP_WHATSAPP_SEND_ENABLED`, inicialmente `false`. La integración sigue [la API de envío de Resend](https://resend.com/docs/api-reference/emails/send-email) y sus [claves de idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys).

Los cuatro pasos de email utilizan las plantillas HTML publicadas de Resend, con los aliases registrados en `templates/resend-templates.json`. El worker envía el nombre escapado cuando corresponde y la URL de baja firmada; el enlace de reserva usa el valor por defecto de la plantilla. Resend sirve también la alternativa de texto. Las fotos de los casos están alojadas en URLs públicas estables de Supabase Storage. Ver [edición y publicación de plantillas](../templates/README.md) antes de modificar contenido, variables o imágenes.

Aplicar las nuevas migraciones primero en la base local y revisar el destino antes de aplicar en Supabase remoto. No habilitar envíos en una base de pruebas. La migración `20261008000400_supabase_followup_cron.sql` crea el cron de seguimiento **pausado**. Las migraciones `20261008000500_followup_edge_worker.sql` y `20261008000600_followup_edge_api_key_auth.sql` cambian su destino a Supabase y su autenticación a la clave privada de API, sin alterar los trabajos pendientes ni el estado de activación. Ninguna configura secretos ni llama a proveedores.

El trabajo `process-followup-queue` ejecuta **cada minuto** `private.invoke_followup_worker()`, que llama mediante `pg_net` a `POST https://PROJECT_REF.supabase.co/functions/v1/process-followup-queue`. La Edge Function consulta los RPC de selección y reclamación, envía mediante Resend y persiste el resultado. El envío ya no depende de Vercel y la antigua ruta `/api/followups/process` se ha retirado.

Antes de cambiar el cron, desplegar la función con `pnpm exec supabase functions deploy process-followup-queue`. Esta función utiliza `verify_jwt=false` y el wrapper `withSupabase({ auth: 'secret' })`: el SDK valida la clave privada `default` del proyecto en la cabecera `apikey` antes de consultar la base de datos. Las llamadas sin credenciales, con claves públicas o con JWT de usuario se rechazan con `401`. Es el patrón de [autenticación entre servicios recomendado por Supabase](https://supabase.com/docs/guides/functions/auth).

Guardar en **Supabase Vault** `followup_project_url` (la URL base HTTPS del proyecto Supabase) y `followup_worker_secret_key` (su clave privada `default`, con formato `sb_secret_...`). No incluir secretos en migraciones, Git ni el texto del cron. Para cambiar valores existentes usar `vault.update_secret`. Los antiguos `followup_site_url`, `followup_cron_secret`, `followup_worker_service_role_jwt` y `FOLLOWUP_CRON_SECRET` dejan de utilizarse. Este reparto utiliza [Supabase Cron, pg_net y Vault](https://supabase.com/docs/guides/functions/schedule-functions).

Tras comprobar que producción responde correctamente, activar únicamente este trabajo:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'process-followup-queue'),
  active := true
);
```

Para pausarlo, ejecutar lo mismo con `active := false`. Mantener el cron anterior `process-whatsapp-queue` pausado hasta configurar WhatsApp. Un resultado `succeeded` en `cron.job_run_details` solo confirma que se encoló la petición HTTP: comprobar también el código HTTP y el contenido de `net._http_response`, y el estado de `followup_jobs`. El worker devuelve `200` cuando procesa sin errores y `401` si el secreto no coincide.

Se procesan lotes de 10 con dos envíos simultáneos como máximo entre instancias. Los errores temporales rechazados por el proveedor se reintentan tras 60 y 300 segundos, hasta tres intentos. Un timeout, respuesta ambigua o proceso interrumpido deja `delivery_unknown` para revisión manual, sin reenvío automático. `sent` indica aceptación del proveedor, no entrega al teléfono o buzón. Una reserva o baja recibida después de haber iniciado una petición de envío no puede recuperar ese mensaje.

Las próximas llamadas y su estado «CONFIRMO recibido» o «Pendiente de revisión» aparecen en `/admin/calls`. Desde ahí se puede abrir Cal.com para gestionar la reserva manualmente. También se puede consultar la revisión en Supabase:

```sql
-- Llamadas futuras sin CONFIRMO.
select uid,email,start_time,time_zone,meeting_url from public.call_bookings
where status='booked' and confirmed_at is null and start_time>now() order by start_time;
-- Trabajos que necesitan atención.
select id,step,status,last_error,scheduled_at from public.followup_jobs
where status='failed' or last_error in ('missing_template','missing_meeting_url');
-- Reservas cuyo email aún no se ha registrado en el webinar.
select uid,email,start_time from public.call_bookings where registration_id is null;
```

## Actualización del flujo fijo (9 de octubre de 2026)

Aplicar las migraciones pendientes hasta `20261009190000_fixed_meta_whatsapp_templates.sql`, desplegar `process-followup-queue` y publicar el frontend. La nueva migración sustituye la vinculación por texto exacto por nombres fijos de Meta, elimina la configuración manual de asociaciones y aporta al worker los componentes reales de la plantilla. No activa envíos, reinicia secuencias ni reprograma trabajos. Los reintentos conservan su snapshot y los resultados inciertos siguen requiriendo revisión manual.

La liberación automática de plazas queda fuera de esta iteración por decisión expresa del usuario. El administrador cancela manualmente en Cal.com y el webhook retira los recordatorios pendientes. La confirmación automática de asistencia permanece pausada.
