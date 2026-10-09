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
| WhatsApp | Seguimiento de la llamada | +1 minuto | Consentimiento WhatsApp y ninguna reserva asociada. |
| WhatsApp | Invitación a reservar | +3 minutos | Consentimiento WhatsApp y ninguna reserva asociada. |
| WhatsApp | Cierre del seguimiento | +5 minutos | Consentimiento WhatsApp, ninguna reserva y ninguna respuesta registrada. |
| Email | Email 1: claridad | +1 minuto | Consentimiento email y sin baja. |
| Email | Email 2: casos | +3 minutos | Consentimiento email y sin baja. |
| Email | Email 3: empezar | +5 minutos | Consentimiento email y sin baja. |
| Email | Email 4: resultados | +7 minutos | Consentimiento email y sin baja. |

Los tiempos se cuentan desde la inscripción. Aplicar `20261009200000_followup_minute_schedule.sql` para las nuevas inscripciones; los trabajos existentes conservan su fecha. El cron procesa la cola cada minuto, por lo que el envío puede producirse en la siguiente ejecución.
