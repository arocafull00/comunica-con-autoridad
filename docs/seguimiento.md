# Inscripción al webinar y reserva de llamada

La inscripción se registra cuando se guardan las seis respuestas del formulario, se confirma la copia en Google Sheets y el servidor concede acceso al vídeo. No se exige reproducir o terminar el vídeo. La marca de acceso de localStorage no inscribe contactos antiguos automáticamente.

`POST /api/leads` guarda por separado el consentimiento opcional de WhatsApp y el de comunicaciones por email, con fecha y versión del texto. Las casillas empiezan desmarcadas. La falta de permiso no impide acceder al vídeo. Cada email admite baja; WhatsApp admite `BAJA` y `STOP`.

Una dirección de email entra una sola vez en el webinar. Los reintentos conservan la fecha inicial y los trabajos; volver a registrarse con otro identificador no reinicia los mensajes. La reserva se relaciona por el email del titular, normalizado a minúsculas: debe usar el mismo email en Cal.com. Una reserva con otro email queda guardada sin asociar y no genera mensajes hasta que ese email complete el formulario.

## Secuencia

| Evento | Canal | Momento | Condición |
| --- | --- | --- | --- |
| Formulario completo | WhatsApp | +1 hora | Permiso y ninguna reserva registrada |
| Formulario completo | WhatsApp | +1 día | Permiso y ninguna reserva registrada |
| Formulario completo | WhatsApp | +3 días | Permiso, ninguna reserva y ninguna respuesta por WhatsApp |
| Formulario completo | Resend | +30 minutos, +1, +2 y +3 días | Permiso de comunicaciones; continúa si reserva |
| Reserva en Cal.com | WhatsApp | Inmediato | Permiso y reserva asociada |
| Llamada | WhatsApp | −24 horas, −2 horas y −15 minutos | Permiso y reserva vigente |

Los textos están en `public.followup_steps` y el original preparado en `lib/followups/messages.json`. Los dos emails rotulados «Email 4» en el documento corresponden a los pasos 3 y 4. Se ha adaptado el aviso de liberación de plaza a **revisión manual**, según la decisión del usuario. El original conserva la discrepancia Mateo/Álvaro y 35/45 minutos: revisar estos detalles de contenido antes de activar.

No se recuperan recordatorios cuyo momento ya pasó al reservar: si alguien reserva a 1 hora de la sesión, solo recibe la confirmación y el recordatorio de 15 minutos. Los recordatorios tienen una tolerancia máxima de 30 minutos y siempre caducan antes de empezar la llamada; los de webinar y emails caducan 6 horas después de su fecha. Un sistema pausado no enviará de golpe una secuencia antigua al reactivarse.

`CONFIRMO` registra asistencia cuando el teléfono tiene una única reserva futura asociada y la respuesta es posterior a su creación o cambio. Si hay varias llamadas futuras para ese teléfono o una respuesta llega antes de su webhook, la respuesta queda registrada para revisión; no se confirman varias llamadas por inferencia. No se cancelan llamadas por falta de respuesta. Cancelarlas manualmente en Cal.com retira los recordatorios al recibir su webhook. Después de una cancelación no se reinicia automáticamente la secuencia de captación.

## Cal.com

Crear un webhook **del tipo de evento** `sesion-gratuita-comunicacion`, sin plantilla personalizada, apuntando a:

```text
https://TU-DOMINIO/api/webhooks/cal
```

Suscribir `BOOKING_CREATED`, `BOOKING_RESCHEDULED` y `BOOKING_CANCELLED`. Configurar el mismo secreto aleatorio de al menos 32 caracteres en Cal.com y en `CAL_WEBHOOK_SECRET` del servidor. El receptor comprueba `X-Cal-Signature-256` sobre el cuerpo original. `CAL_EVENT_SLUG` permite restringir otro tipo de sesión.

La fecha `createdAt` ordena los eventos por reserva; los duplicados y eventos anteriores no restauran una cita cancelada. En una reprogramación, `payload.uid` identifica la nueva reserva y `payload.rescheduleUid` la anterior. Se conservan las reservas sin contacto para relacionarlas cuando llegue el registro. Para Google Meet se lee `metadata.videoCallUrl` o una URL HTTPS en `location`. El recordatorio de 2 horas espera a disponer de enlace y caduca si no llega; nunca incluye un placeholder vacío. La hora del recordatorio utiliza la zona horaria del asistente.

Documentación del proveedor: [webhooks de Cal.com](https://github.com/calcom/help/blob/main/webhooks.mdx).

## WhatsApp

Configurar el webhook de Meta en `https://TU-DOMINIO/api/webhooks/whatsapp` y suscribir `messages`. Next.js necesita `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`. El GET valida el challenge; los POST validan `X-Hub-Signature-256` y solo admiten el número de negocio configurado. Los identificadores de mensajes evitan procesar dos veces una respuesta. Las notificaciones de estado no cuentan como respuestas.

Crear y aprobar en Meta las siete plantillas del flujo con el cuerpo de cada paso en `followup_steps`. Los únicos parámetros posicionales son `{{1}}` para nombre (`webinar_1h`), hora (`booking_24h`) y enlace (`booking_2h`); las otras plantillas no tienen parámetros. No añadir botones o cabeceras que requieran componentes adicionales.

Configurar las credenciales de envío de WhatsApp en el **servidor Next.js**, además de las que utiliza el worker de bienvenida anterior. `FOLLOWUP_WHATSAPP_TEMPLATES` es un JSON de este formato, utilizando los nombres reales aprobados:

```json
{
  "booking_confirmation": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "booking_24h": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "booking_2h": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "booking_15m": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "webinar_1h": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "webinar_1d": { "name": "NOMBRE_REAL_APROBADO", "language": "es" },
  "webinar_3d": { "name": "NOMBRE_REAL_APROBADO", "language": "es" }
}
```

Con el entorno configurado ejecutar `node --env-file=.env.local scripts/sync-followup-templates.mjs`. Este script **solo consulta plantillas aprobadas** y verifica su cuerpo contra cada paso; no crea plantillas, envía mensajes ni activa el sistema. Repetir la sincronización si cambian o se retiran plantillas; el catálogo local no detecta una retirada de aprobación hasta la próxima sincronización.

Para habilitar el flujo hacen falta `FOLLOWUP_WHATSAPP_SEND_ENABLED=true` y el interruptor del panel WhatsApp activado. El interruptor del panel también pausa este flujo. La selección de bienvenida existente permanece para clientes antiguos de la API: un formulario completo ya no envía esa bienvenida adicional.

## Resend y ejecución

Preparar un remitente con dominio verificado y configurar `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_SITE_URL` (HTTPS público) y `EMAIL_UNSUBSCRIBE_SECRET` (al menos 32 caracteres). Cada envío utiliza `Idempotency-Key: followup/<id del trabajo>` y un enlace firmado de baja que exige pulsar un botón; un escáner de enlaces no da de baja automáticamente.

Para habilitar emails usar `FOLLOWUP_EMAIL_SEND_ENABLED=true`. La integración sigue [la API de envío de Resend](https://resend.com/docs/api-reference/emails/send-email) y sus [claves de idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys).

Aplicar las nuevas migraciones primero en la base local y revisar el destino antes de aplicar en Supabase remoto. No habilitar envíos en una base de pruebas. No hay Cron nuevo activado ni llamada a proveedores en las migraciones.

Para procesar los trabajos, un planificador debe llamar **cada minuto** a `GET` o `POST https://TU-DOMINIO/api/followups/process`, con `Authorization: Bearer <FOLLOWUP_CRON_SECRET>`. El secreto debe tener al menos 32 caracteres. Preparar el planificador de despliegue al conectar los servicios; no existe un cron externo creado por este cambio.

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
