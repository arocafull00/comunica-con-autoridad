| Trigger | Efecto implementado |
|---|---|
| `BOOKING_CREATED` | Guarda/asocia la reserva, detiene los tres WhatsApps de captación pendientes y programa los mensajes de llamada aplicables. |
| `BOOKING_RESCHEDULED` | Descarta los avisos anteriores afectados y programa los de la nueva reserva/fecha. Puede generar una nueva confirmación según la antelación. |
| `BOOKING_CANCELLED` | Descarta los mensajes pendientes de esa llamada. **No reinicia la captación**; los emails continúan. |
| Respuesta entrante de WhatsApp | Detiene únicamente `webinar_3d`. Requiere que el webhook reciba y registre la respuesta. |
| WhatsApp `BAJA` o `STOP` | Retira el consentimiento y bloquea futuros WhatsApps. Depende de recibir el webhook. |
| WhatsApp `CONFIRMO` | **Confirmación automática pausada.** Ningún recordatorio exige `CONFIRMO` para enviarse y no hay cancelación automática por falta de respuesta. |
| Baja desde un email | Tras confirmar la baja mediante el botón, retira el consentimiento y descarta los emails pendientes. |
| Repetir inscripción con el mismo email | No reinicia la secuencia ni cambia su fecha inicial. |




| Canal | Evento | Momento | Condición |
|---|---|---|---|
| WhatsApp | Seguimiento de la clase | +1 hora | Móvil enviado en el segundo formulario y ninguna reserva asociada. |
| WhatsApp | Invitación a reservar | +1 día | Móvil enviado en el segundo formulario y ninguna reserva asociada. |
| WhatsApp | Cierre del seguimiento | +3 días | Móvil enviado en el segundo formulario, ninguna reserva y ninguna respuesta registrada. |
| Email | Email 1: claridad | +30 minutos | Consentimiento email y sin baja. |
| Email | Email 2: casos | +1 día | Consentimiento email y sin baja. |
| Email | Email 3: empezar | +2 días | Consentimiento email y sin baja. |
| Email | Email 4: resultados | +3 días | Consentimiento email y sin baja. |

Los tiempos de email se cuentan desde la primera inscripción con email; los de WhatsApp se cuentan desde el envío del segundo formulario. La migración `20261012000100_restore_followup_schedule.sql` restaura los horarios originales para las nuevas inscripciones; los trabajos existentes conservan su fecha. El cron procesa la cola cada minuto, por lo que el envío puede producirse en la siguiente ejecución.
