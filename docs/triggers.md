# Notificaciones: triggers y horarios de envío

Referencia única de los envíos automáticos de la aplicación. Revisada el **14/10/2026** contra el código, las migraciones y la configuración de Supabase en producción. La configuración técnica está en [activación](activacion.md); el recorrido del usuario, en [formulario de la masterclass](formulario-masterclass.md).

## Vista rápida: evento → WhatsApp y correo

**Cada fila indica qué mensaje provoca ese evento y cuándo.** Las frases de WhatsApp proceden del catálogo sincronizado de Meta; las de correo identifican su asunto o encabezado. **—** significa que la aplicación no genera un mensaje nuevo por ese canal.

| Evento y momento | WhatsApp: mensaje identificable | Correo: mensaje identificable | Cuándo se aplica |
| --- | --- | --- | --- |
| **Inscripción con email → +30 minutos** | — | 📧 **Email 1 · Claridad:** «Quédate con esta idea de la masterclass que has visto.» | Casilla de email marcada y sin baja. |
| **Inscripción con email → +1 día** | — | 📧 **Email 2 · Casos:** «Te presento a Santiago, Maria y Mateo.» | Casilla de email marcada y sin baja. |
| **Inscripción con email → +2 días** | — | 📧 **Email 3 · Empezar:** «Ojalá hubiese empezado antes». | Casilla de email marcada y sin baja. |
| **Inscripción con email → +3 días** | — | 📧 **Email 4 · Resultados:** «Transferencia recibida.» | Casilla de email marcada y sin baja. Es seguimiento programado, no una confirmación de pago. |
| **Contacto con WhatsApp aceptado → +1 hora** | 💬 **Seguimiento de la clase:** «Gracias por apuntarte a la clase, [nombre]! ¿Pudiste verla entera?» | — | Consentimiento WhatsApp y ninguna reserva asociada. |
| **Contacto con WhatsApp aceptado → +1 día** | 💬 **Invitación a reservar:** «Si quieres que analicemos dónde te está pasando a ti, puedes reservar aquí». | — | Consentimiento WhatsApp y ninguna reserva asociada. |
| **Contacto con WhatsApp aceptado → +3 días** | 💬 **Cierre del seguimiento:** «Viendo que de momento no te interesa dar el siguiente paso, te dejo este último mensaje por aquí». | — | Consentimiento WhatsApp, ninguna reserva ni respuesta registrada. |
| **Reserva en Cal.com con ≥24 horas de antelación → inmediato** | 💬 **Con el flujo con audios activo:** «¡Buenas, [nombre]! … Pulsa OK para confirmar que has recibido la información» con fecha, hora local y Meet. **Sin él:** «¡Hola! Vi que reservaste tu sesión». | **App: —. Cal.com:** posible correo propio de confirmación; configuración y contenido pendientes de verificar. | Reserva vinculada al mismo email, móvil y consentimiento WhatsApp. |
| **Pulsa OK → inmediato** | 🎧 **Primer audio de Ignacio**, una sola vez. | — | OK de la reserva y revisión vigentes; ventana de 24 horas abierta. |
| **Meta acepta el primer audio → +2 horas** | 💬 **Petición de confirmación:** «Solo necesitamos que confirmes tu asistencia» + Meet y botón CONFIRMAR. | — | Se omite si ya ha confirmado o la llamada ha empezado. |
| **Reserva en Cal.com con ≥2 y <24 horas de antelación → inmediato** | 💬 **Confirmación de reserva próxima:** «Para mantener la sesión, respóndeme “CONFIRMO”». | **App: —. Cal.com:** posible correo propio de confirmación; configuración y contenido pendientes de verificar. | Sustituye a la confirmación habitual; mismo email, móvil y consentimiento WhatsApp. |
| **Reserva en Cal.com con <2 horas de antelación** | **Sin confirmación inmediata.** Solo se programa el aviso de 15 minutos si aún está a tiempo. | **App: —. Cal.com:** depende de su configuración externa. | Mismo email, móvil y consentimiento WhatsApp. |
| **Llamada reservada → 24 horas antes** (solo sin flujo con audios) | 💬 **Recordatorio de mañana:** «Mañana tenemos nuestra sesión». | **App: —. Cal.com:** sus posibles recordatorios tienen una configuración externa. | Reserva vigente; el horario no debe haber pasado al programar. |
| **Llamada reservada → 2 horas antes** | 💬 **Recordatorio con Meet:** «Tu reunión reservada empieza en un par de horas» + enlace de Google Meet. | **App: —. Cal.com:** depende de su configuración externa. | Reserva vigente y enlace real de Meet disponible. |
| **Llamada reservada → 2 horas antes + 1 minuto** | 🎧 **Segundo audio de Ignacio.** | — | Solo flujo con audios, con OK recibido y ventana de 24 horas abierta; si no, se omite y el recordatorio con Meet sale igual. |
| **Llamada reservada → 15 minutos antes** | 💬 **Último aviso:** «En 15 minutos empezamos. Nos vemos ahora.» | **App: —. Cal.com:** depende de su configuración externa. | Reserva vigente; el horario no debe haber pasado al programar. |
| **Reprogramación en Cal.com** | Se descartan los avisos anteriores afectados y se programan los de la nueva fecha; puede salir otra confirmación de reserva. | **App: sin correo nuevo.** Continúan los cuatro emails de seguimiento; los avisos propios de Cal.com dependen de su configuración. | Se recalculan antelación y recordatorios para la reserva vigente. |
| **Cancelación en Cal.com** | **Sin mensaje de cancelación desde la app.** Se descartan los avisos pendientes de esa llamada y no se reinicia el seguimiento de clase. | **App: sin correo nuevo.** Continúan los cuatro emails de seguimiento; un posible correo de cancelación de Cal.com depende de su configuración. | Al recibir el webhook de cancelación. |

**Al reservar, nuestra aplicación envía WhatsApp según la antelación y mantiene la secuencia de correo ya programada.** No genera un email de reserva. Los correos de confirmación, cambio o cancelación de Cal.com son externos y no se deben dar por activos sin revisar Cal.com.

El primer formulario no envía correo inmediato de acceso. Los relojes de email y WhatsApp empiezan en formularios distintos; que dos filas indiquen «+1 día» no significa que salgan a la vez. «Inmediato» se procesa en el siguiente ciclo del worker, que se ejecuta cada minuto. Las condiciones generales de consentimiento y canal habilitado se aplican a todos los envíos.

## Estado comprobado en producción

- `process-followup-queue` está activo y se ejecuta **cada minuto** (`* * * * *`). Procesa tanto WhatsApp como correo.
- Los flags del servicio son `FOLLOWUP_EMAIL_SEND_ENABLED=true`, `FOLLOWUP_WHATSAPP_SEND_ENABLED=true` y `FOLLOWUP_WHATSAPP_TEST_ENABLED=false`. Se comprobaron mediante los hashes de los secretos, sin leer sus valores.
- `whatsapp_settings.enabled=true`; las ocho plantillas fijas figuran como `APPROVED` en el catálogo sincronizado.
- Los tiempos de `followup_steps.delay_seconds` coinciden con las tablas siguientes. La prueba temporal en minutos terminó con `20261012000600_restore_normal_followup_timings.sql`.
- El cron antiguo `process-whatsapp-queue` está **pausado**. La masterclass no genera una bienvenida adicional.

Esta comprobación acredita la configuración y hay trabajos `sent` de ambos canales en el historial. No acredita entrega en el teléfono o la bandeja de entrada, ni la recepción real de respuestas por el webhook de Meta. Los correos propios de Cal.com se administran fuera de esta aplicación; sus horarios no se han verificado aquí.

La API antigua `POST /api/leads` aún puede encolar una bienvenida al crear un contacto con consentimiento WhatsApp y sin profesión. Su worker separado tiene una frecuencia configurada de 30 segundos, pero su cron está pausado: no es un envío automático activo del flujo actual.

## Desde cuándo se cuentan los plazos

| Referencia | Evento que inicia el reloj |
| --- | --- |
| **E: inscripción con email** | Primera inscripción de ese email, guardada por `POST /api/leads/access`. No requiere completar el segundo formulario ni ver el vídeo. |
| **W: contacto con WhatsApp** | Paso de contacto de «Agendar llamada» guardado por `POST /api/leads/access` con la casilla de WhatsApp marcada, antes de las preguntas. En páginas antiguas, el segundo formulario de `POST /api/leads/qualification`. |
| **C: inicio de la llamada** | `start_time` de la reserva vigente recibida desde Cal.com. La reserva se asocia por el mismo email, normalizado a minúsculas. |

Los días son intervalos de **24 horas**, no envíos a una hora fija del día. No hay franja de silencio nocturna ni restricción a días laborables en este flujo. Por ejemplo, si E es el lunes a las 18:00, los emails se programan para el lunes a las 18:30, martes a las 18:00, miércoles a las 18:00 y jueves a las 18:00, salvo un cambio de hora estacional al mostrarlos en hora local.

## Correo: cuatro emails de seguimiento

Se crean únicamente si se marca la casilla opcional de email del primer formulario. Antes de cada envío se comprueban de nuevo el consentimiento y la ausencia de baja. **Continúan aunque la persona reserve, reprograme o cancele una llamada.**

| Paso | Contenido / alias publicado en Resend | Cuándo se programa | Segundos desde E |
| --- | --- | --- | ---: |
| `email_1` | Claridad · `email-1-claridad` | E + **30 minutos** | 1800 |
| `email_2` | Casos · `email-2-casos` | E + **1 día** | 86400 |
| `email_3` | Empezar · `email-3-empezar` | E + **2 días** | 172800 |
| `email_4` | Resultados · `email-4-resultados` | E + **3 días** | 259200 |

El contenido servido es el de las plantillas publicadas de Resend: [edición y publicación](../templates/README.md). La aplicación no envía un correo inmediato de acceso ni correos de confirmación o recordatorios de la llamada. Estos últimos, si están habilitados, los envía **Cal.com con su propia configuración**, independiente de los cuatro emails anteriores.

## WhatsApp: seguimiento de la clase

Requiere móvil y `whatsapp_consent=true`, registrado al guardar el contacto con la casilla de WhatsApp marcada. Los tres pasos solo se envían si **no existe ninguna reserva asociada a la inscripción**, incluso si esa reserva ya fue cancelada o reprogramada.

| Paso | Mensaje | Cuándo se programa | Plantilla fija de Meta · idioma | Condición adicional |
| --- | --- | --- | --- | --- |
| `webinar_1h` | Pregunta sobre la clase y qué quiere mejorar | W + **1 hora** (3600 s) | `seguimiento_webinar_1h` · `es` | Usa el nombre; si falta, «comunicador/a». |
| `webinar_1d` | Invitación a reservar una sesión | W + **1 día** (86400 s) | `no_reservan_1dia_despues` · `es` | Incluye el botón de reserva fijo de Meta. |
| `webinar_3d` | Cierre del seguimiento | W + **3 días** (259200 s) | `seguimiento_no_reserva_3dia` · `en` | No debe haber ninguna respuesta WhatsApp registrada. |

Responder no detiene los avisos de 1 hora y 1 día: solo descarta el de 3 días. `BAJA` o `STOP` impiden todos los WhatsApp posteriores que requieran consentimiento. Estas reglas necesitan que Meta entregue la respuesta al webhook y que se registre correctamente.

## WhatsApp: reserva y recordatorios de llamada

Requiere reserva futura vigente, asociada a la inscripción, móvil y consentimiento WhatsApp. La antelación se calcula desde la **fecha del evento de creación o reprogramación en Cal.com** (`last_event_at`), no desde la llegada tardía del webhook.

| Paso | Cuándo se programa | Plantilla fija de Meta · idioma | Condición |
| --- | --- | --- | --- |
| `booking_confirmation` | **Inmediato**, al procesar la reserva | `whatsapp_confirmacion_reserva` · `es` | Reserva con **24 horas o más** de antelación. Incluye imagen. |
| `booking_short_notice` | **Inmediato**, al procesar la reserva | `reserva_menos_24hantes` · `en` | Reserva con **2 horas o más y menos de 24 horas**. Sustituye a la confirmación habitual; incluye imagen. |
| `booking_24h` | C − **24 horas** (−86400 s) | `recordatorio_24hantes` · `en` | Ese momento debe seguir en el futuro al programar. |
| `booking_2h` | C − **2 horas** (−7200 s) | `recordatorio_reunion_2h` · `es` | Ese momento debe seguir en el futuro y debe existir un enlace HTTPS real de Meet. |
| `booking_15m` | C − **15 minutos** (−900 s) | `15_minutos_antes` · `en` | Ese momento debe seguir en el futuro al programar. |

Con **menos de 2 horas** de antelación no se envía confirmación inmediata ni recordatorio de 2 horas: solo el de 15 minutos, si todavía procede. Si quedan 15 minutos o menos al programar, tampoco se recupera ese aviso. Exactamente a 24 horas o 2 horas, el recordatorio correspondiente ya está vencido al procesar y se descarta; no se envía de forma retroactiva.

«Inmediato» significa disponible en la cola al procesar la reserva; la petición a Meta se hace en una ejecución del worker. Si la reserva llegó antes de facilitar el móvil, los avisos se programan al completar el segundo formulario, siempre que la llamada siga siendo futura. Si el email no coincide, se guarda la reserva sin asociar y no se generan sus WhatsApp hasta que pueda vincularse a una inscripción con móvil y consentimiento.

El contenido de WhatsApp lo sirve Meta. Los identificadores `en` son los idiomas realmente registrados allí, aunque el texto sea español. El panel permite consultarlo, pero no editar plantillas, elegirlas o activar envíos.

## WhatsApp: flujo de reserva con audios

Se aplica a reservas nuevas y reprogramaciones con **24 horas o más** de antelación cuando el interruptor está activo ([activación](activacion.md#flujo-de-reserva-con-audios)). Las reservas existentes conservan sus trabajos y las de menos de 24 horas siguen las reglas anteriores. Sustituye a `booking_confirmation` y elimina `booking_24h`.

| Paso | Cuándo | Plantilla / contenido | Condición |
| --- | --- | --- | --- |
| `booking_ok_request` | **Inmediato** | `reserva_recibida_ok` · `es`: nombre, fecha, hora local, Meet y botón OK | Sin Meet todavía, muestra «te lo enviaremos antes de la sesión». |
| `booking_audio_1` | Al recibir el OK | Audio `primer-audio-reserva.ogg` | Una vez por revisión; ventana de 24 horas abierta. |
| `booking_confirm_request` | 2 horas después de que Meta acepte el audio 1 | `reserva_confirmar_asistencia` · `es`: nombre, Meet y botón CONFIRMAR | Se omite si ya hay confirmación o la llamada ha empezado. |
| `booking_2h` | C − **2 horas** | `recordatorio_reunion_2h` · `es` | Igual que antes: espera el enlace real de Meet. |
| `booking_audio_2` | C − 2 horas + 1 minuto | Audio `segundo-audio-reserva.ogg` | OK recibido y ventana abierta; si no, se omite con el motivo (`ok_not_received`, `whatsapp_window_closed`). |
| `booking_15m` | C − **15 minutos** | `15_minutos_antes` · `en` | Igual que antes. |

WhatsApp solo permite mensajes que no son plantilla, como los audios, durante las 24 horas siguientes al último mensaje del cliente ([política](https://whatsappbusiness.com/policy/)); el worker exige una respuesta registrada en las últimas 23 h 55 min. Los botones llevan el identificador del trabajo, de modo que una cancelación o reprogramación invalida los botones y trabajos de la revisión anterior. No se avisa a Eduardo ni se cancela ninguna reserva automáticamente.

## Triggers que cambian o detienen envíos

| Evento | Efecto sobre los trabajos pendientes |
| --- | --- |
| `BOOKING_CREATED` | Asocia la reserva por email, descarta los tres WhatsApp de seguimiento de clase y programa los avisos de llamada aplicables. Los emails continúan. |
| `BOOKING_RESCHEDULED` | Descarta los avisos afectados de la reserva anterior y programa los de la nueva fecha/revisión. Puede crear otra confirmación según la nueva antelación; reinicia la confirmación de asistencia cuando cambia la reserva. |
| `BOOKING_CANCELLED` | Descarta los avisos pendientes de esa llamada. **No reinicia la captación WhatsApp**. Los emails continúan. |
| Cualquier respuesta WhatsApp registrada, posterior a la inscripción | Guarda la respuesta y descarta únicamente `webinar_3d`. No responde automáticamente al contacto. |
| WhatsApp `BAJA` o `STOP` | Retira el consentimiento para ese teléfono. Los demás trabajos WhatsApp pendientes se descartan al comprobarlo antes de enviar. No da de baja los emails. |
| Botón **OK** del mensaje de reserva | Registra «OK recibido» (`ok_received_at`) y programa una vez el primer audio. Solo cuenta para la reserva y revisión de ese mensaje; un OK duplicado no repite el audio. Un «OK» escrito solo cuenta si hay una única reserva esperando el OK. No confirma la asistencia. |
| Botón **CONFIRMAR** | Registra `confirmed_at` para la reserva y revisión de ese mensaje. Los botones de una reserva cancelada o reprogramada no cambian nada. |
| WhatsApp `CONFIRMO` o `CONFIRMAR` escritos | Detección **activa en el código**. Registra `confirmed_at` si el teléfono tiene una única reserva futura y la respuesta es posterior a su creación/cambio. No envía otro mensaje, no acepta la reserva por la API de Cal.com y no es requisito para los recordatorios. |
| No responder `CONFIRMO` | No cancela la reserva ni bloquea los avisos. La revisión y cancelación son manuales en Cal.com. |
| Baja desde un email | Solo al confirmar con el botón de baja: marca la inscripción como dada de baja y descarta sus emails pendientes. Abrir el enlace con GET no basta; WhatsApp conserva su consentimiento independiente. |
| Repetir la inscripción con el mismo email o reintentar el formulario | Conserva una única inscripción y los trabajos existentes; no reinicia la secuencia ni reenvía pasos terminados. |

Las palabras clave se reconocen como comandos completos en texto o botones, sin distinguir mayúsculas y con espacios o puntuación alrededor. Una respuesta ambigua o con varias llamadas futuras no confirma varias reservas. Los duplicados de webhooks no crean envíos adicionales.

## Cuándo se realiza realmente el envío

1. Supabase guarda cada instancia en `followup_jobs` con `scheduled_at` y `expires_at`. `followup_steps` define el desfase de los nuevos trabajos; la fecha concreta del trabajo manda para el ya creado.
2. Cada minuto el cron invoca `process-followup-queue`, que sincroniza el catálogo de Meta y consulta trabajos cuyo momento ya ha llegado. Si falla el catálogo, pausa WhatsApp durante esa ejecución y sigue con email.
3. Antes de reclamar cada trabajo se revisan consentimiento, baja, caducidad, reserva/revisión vigente y condiciones del paso. WhatsApp exige además canal habilitado y plantilla aprobada; `booking_2h` espera al enlace de Meet dentro de su ventana.
4. El worker hace la petición a Meta o Resend y guarda el resultado. En funcionamiento normal, un trabajo vence y se procesa en el siguiente ciclo del cron, más el tiempo de procesamiento. Fallos, cola o límites del proveedor pueden retrasarlo: **no hay garantía de envío al segundo exacto**.

| Tipo de mensaje | Hasta cuándo puede enviarse si se retrasa |
| --- | --- |
| Emails y WhatsApp de seguimiento de clase | Hasta **6 horas después** de `scheduled_at` inicial; después se descartan por caducidad. |
| Confirmación inmediata de reserva | Hasta el **inicio de la llamada**. |
| Recordatorios de llamada | Hasta **30 minutos después** de su horario inicial, siempre **antes del inicio de la llamada**. El de 15 minutos caduca al empezar la llamada. |

Ante un rechazo transitorio confirmado, se reintenta tras **60 segundos** y luego **5 minutos**, con un máximo de **3 intentos** y sin superar la caducidad. Los timeouts, errores de red o resultados ambiguos quedan como `failed / delivery_unknown` para revisión manual. Pausar impide nuevas reclamaciones; un envío ya iniciado puede terminar. Reactivar solo permite los trabajos que sigan dentro de su ventana.

La restauración del 12/10 ajustó los trabajos normales pendientes sin intentos y conservó el historial de envíos/intentos. Por eso los envíos históricos de la prueba pueden mostrar intervalos en minutos. El sandbox aislado conserva +1/+3/+5 minutos desde `registered_at` (la inscripción con email, no el segundo formulario) y `hello_world`, pero está desactivado en la comprobación actual y sus trabajos no pasan al canal real.

## Comprobar fechas concretas

`scheduled_at` es la próxima fecha prevista (puede cambiar por reintento); `sent_at` es cuándo el proveedor **aceptó** la petición. `sent` no prueba entrega ni lectura. El receptor actual de Meta no guarda estados de entrega y lectura. Un cron `succeeded` solo acredita la invocación SQL, no el resultado del worker.

Consulta administrativa sin datos de contacto; las horas se muestran en **Europe/Madrid**:

```sql
select j.id, j.step, s.channel, j.status,
       j.scheduled_at at time zone 'Europe/Madrid' as programado_madrid,
       j.expires_at at time zone 'Europe/Madrid' as caduca_madrid,
       j.sent_at at time zone 'Europe/Madrid' as aceptado_madrid,
       j.attempts, j.last_error, j.provider_message_id
from public.followup_jobs j
join public.followup_steps s on s.key = j.step
where not j.test_mode
order by j.scheduled_at desc;
```

## Fuentes de la implementación

- [Horarios normales y restauración](../supabase/migrations/20261012000600_restore_normal_followup_timings.sql).
- [Inscripción con email](../supabase/migrations/20261012000200_email_first_masterclass.sql) y [registro sin reiniciar secuencias](../supabase/migrations/20261009130000_two_stage_masterclass.sql).
- [Segundo formulario y contactos repetidos](../supabase/migrations/20261012000400_repeat_email_qualification.sql), [contacto antes de las preguntas](../supabase/migrations/20261014000100_unified_masterclass_contact.sql) y [flujo de reserva con audios](../supabase/migrations/20261014000200_whatsapp_booking_audio_flow.sql).
- [Selección según antelación](../supabase/migrations/20261012000500_followup_minute_test_schedule.sql) — su función sigue vigente con los tiempos normales restaurados.
- [Plantillas fijas y controles antes de enviar](../supabase/migrations/20261009190000_fixed_meta_whatsapp_templates.sql).
- [Reservas, bajas, caducidad y reintentos](../supabase/migrations/20261007000800_webinar_call_followups.sql), [protección de eventos y respuestas](../supabase/migrations/20261008000200_followup_event_guards.sql) y [palabras clave](../lib/followups/whatsapp.ts).
- [Procesador de ambos canales](../supabase/functions/process-followup-queue/worker.ts) y [cron cada minuto](../supabase/migrations/20261008000400_supabase_followup_cron.sql).
