> Auditoría previa a la corrección. El código local ahora usa nombres fijos de Meta y un dashboard de consulta. El estado de producción descrito aquí corresponde a la comprobación anterior al despliegue; véase `seguimiento.md`.

# Auditoría de los envíos automáticos de WhatsApp

Fecha: 9 de octubre de 2026. Revisión del código local, base de datos y configuración de Supabase en producción, código descargado de la función desplegada y catálogo actual de Meta. No se activaron envíos, se modificaron secretos, se aplicaron migraciones ni se enviaron mensajes durante esta auditoría.

**Resultado: los triggers y el procesador están preparados, pero producción todavía no está preparada para enviar la secuencia real.** La prueba manual recibida en el móvil confirma que el número puede enviar esa plantilla mediante `whatsapp_business_tools`; no comprueba las credenciales o el recorrido de nuestra aplicación.

## Bloqueos verificados

| Elemento | Estado observado | Trabajo pendiente |
| --- | --- | --- |
| Canal real de Supabase | `FOLLOWUP_WHATSAPP_SEND_ENABLED=false`. | Activar solo al terminar la preparación y autorizar el envío real. |
| Modo de pruebas | `FOLLOWUP_WHATSAPP_TEST_ENABLED=true`; la configuración privada de pruebas también está activada. Este modo impide cargar el canal real aunque se active su flag. | Deshabilitar ambos controles de pruebas al pasar al canal real. No convertir sus trabajos en envíos reales. |
| Número emisor del worker | Falta el secreto `WHATSAPP_PHONE_NUMBER_ID` en Supabase. | Configurar `1341750885693622`, correspondiente a Nacho Roa. Tenerlo en Vercel no lo proporciona a la función de Supabase. |
| Interruptor del panel | `public.whatsapp_settings.enabled=false`. | Activar después de disponer de plantillas vinculadas y configuración válida. |
| Vinculación de plantillas | `private.followup_templates` tiene cero filas. | Resolver las diferencias de contenido/formato e identificar la plantilla de cada trigger; después sincronizar. |
| Migración de mensajes fijos | `20261009170000_fixed_whatsapp_automations.sql` no figura aplicada en producción; tampoco existe `read_whatsapp_automation_catalog()`. | Aplicar la migración pendiente como parte del despliegue. La base aún tiene siete pasos WhatsApp y no tiene `booking_short_notice`. |
| Función desplegada | `process-followup-queue`, versión 9, tiene un `worker.ts` anterior al manejo de nombres vacíos. | Desplegar la versión actual y comprobar el recorrido sin nombre. |

`WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_GRAPH_API_VERSION` existen en los secretos de Supabase. El identificador de cuenta configurado coincide con la cuenta real de Nacho Roa. No se comprobó que el token guardado en Supabase sea vigente ni tenga permiso efectivo para enviar desde ese número; la conexión de las herramientas de Meta usa sus propias credenciales.

## El cron existe, pero sus llamadas no terminan correctamente

- `process-followup-queue` está activo, con frecuencia de un minuto.
- Los valores necesarios para su invocación existen en Supabase Vault, sin exponer sus contenidos en esta revisión.
- Las últimas respuestas HTTP observadas fueron `503`, con `test.error = sandbox_sender_unavailable`.
- `succeeded` en el historial del cron indica que encoló la petición HTTP, no que se enviaran mensajes. El worker puede procesar el canal email antes de fallar en la comprobación del emisor de pruebas.
- El cron antiguo `process-whatsapp-queue` está pausado. No hace falta activarlo para la secuencia de seguimientos; es un flujo diferente.

## Plantillas actuales de Meta frente al contrato del código

Meta tiene ocho plantillas: seis aprobadas y dos pendientes. La migración de mensajes fijos vincula por cuerpo exacto, idioma `es` o `es_ES` y un único componente `BODY`. Los cambios de saltos de línea, negritas, emojis o texto afectan a esa comparación; solo se normalizan CRLF a LF.

| Trigger | Plantilla existente | Estado | Diferencias relevantes |
| --- | --- | --- | --- |
| Confirmación de reserva | `whatsapp_confirmacion_reserva` · `es` | Aprobada | Cabecera de imagen y diferencia de saltos de línea. El worker no aporta una imagen al enviar. |
| Reserva entre 2 y menos de 24 horas | `reserva_menos_24hantes` · `en` | Aprobada | Idioma, cabecera de imagen y texto que promete liberar la plaza, frente a la revisión manual acordada. El paso aún no existe en producción. |
| Recordatorio de 24 horas | `recordatorio_24hantes` · `en` | Aprobada | Idioma, formato y texto que promete liberar automáticamente la plaza. |
| Recordatorio de 2 horas | `recordatorio_reunion_2h` · `es` | Pendiente | Cuerpo distinto del mensaje fijo; conserva una variable para el enlace de Meet. |
| Recordatorio de 15 minutos | `15_minutos_antes` · `en` | Aprobada | Idioma y emoji adicional respecto al mensaje fijo. |
| Seguimiento de una hora | `seguimiento_webinar_1h` · `es` | Pendiente | Cuerpo distinto, con negritas y cambios de redacción; conserva una variable de nombre. |
| Invitación de un día | `no_reservan_1dia_despues` · `es` | Aprobada | Cuerpo distinto y enlace en un botón fijo, mientras el mensaje fijo incluye la URL en el cuerpo. |
| Cierre de tres días | `seguimiento_no_reserva_3dia` · `en` | Aprobada | Idioma y redacción distintos del mensaje fijo. |

La plantilla de un día sí funcionó en el envío manual. Su botón fijo no requiere parámetros de envío adicionales; el bloqueo en la aplicación procede del contrato de vinculación de las automatizaciones, que solo admite `BODY`. No confundirlo con la compatibilidad de la bienvenida antigua, que sí admite botones de URL fija.

Para seguir el contrato actual hay que preparar versiones de Meta que coincidan con los mensajes fijados, obtener aprobación y sincronizar. Si se decide conservar otros contenidos, botones o imágenes, primero hay que definir ese nuevo contrato e implementar la vinculación y los componentes necesarios; no marcar plantillas como compatibles a ciegas ni emparejarlas solo por su nombre.

No reutilizar como promesa de funcionamiento los textos que anuncian cancelación automática: esa función no existe y fue descartada por el usuario. La detección de `CONFIRMO` se ha reactivado en el código para registrar asistencia en el panel; la recepción real desde Meta sigue pendiente de verificar.

## Recorrido y triggers preparados

1. `/api/leads/access` persiste WhatsApp/email y los consentimientos. Después de copiar los datos a Sheets, llama a `register_webinar`; no exige completar las preguntas de reserva ni terminar el vídeo.
2. `register_webinar` crea los trabajos de captación a una hora, un día y tres días solo para contactos con consentimiento WhatsApp. Los reintentos no reinician la secuencia.
3. El webhook de Cal.com procesa `BOOKING_CREATED`, `BOOKING_RESCHEDULED` y `BOOKING_CANCELLED`. Relaciona la reserva con la inscripción por el mismo email y programa o suprime recordatorios.
4. Con la migración pendiente, una reserva con al menos 24 horas usa la confirmación habitual; entre 2 y menos de 24 horas usa la variante corta; a menos de 2 horas solo se programa el aviso de 15 minutos si su horario no ha pasado.
5. El cron llama a la Edge Function, que lee y reclama trabajos mediante RPC, revalida consentimiento, reserva, caducidad, configuración y plantilla, y envía por la API de Meta.
6. El mensaje de dos horas necesita el enlace real de la reunión. Los recordatorios caducan antes del inicio de la llamada; los horarios vencidos no se recuperan al activar el sistema.

En la instantánea de producción había cinco reservas guardadas y ninguna vinculada a una inscripción. Esto no prueba un fallo del webhook: las reservas pueden corresponder a contactos todavía no registrados o a otro email. Sí significa que esas reservas no generan actualmente sus recordatorios asociados. Hace falta probar una reserva con el mismo email de una inscripción nueva.

Los tres trabajos WhatsApp pendientes observados están marcados permanentemente como prueba (`test_mode=true`). No pasarán a ser envíos reales al desactivar las pruebas. No reprogramarlos ni reenviarlos automáticamente.

## Efecto de aplazar los webhooks de WhatsApp

Se mantiene la decisión documentada en [whatsapp-webhooks-pendientes.md](whatsapp-webhooks-pendientes.md): no configurarlos ahora.

Los envíos programados pueden ejecutarse sin recibir webhooks de WhatsApp. Sin recepción verificada para el número real, no se puede garantizar la supresión del cierre de tres días cuando alguien responde ni la baja automática mediante `BAJA`/`STOP`. Estas acciones requerirán gestión manual mientras se mantenga aplazada la recepción. No confundir este aplazamiento con el webhook de Cal.com, que sí es necesario para los triggers de reservas.

## Verificación realizada y límites

- Consultas de lectura a migraciones, configuración, catálogo, funciones SQL, colas, cron y sus respuestas HTTP en Supabase. Se verificaron los flags comparando sus hashes con `true`/`false`, sin obtener ni publicar secretos.
- Descarga del código desplegado a una carpeta temporal, sin sobrescribir el repositorio.
- Reproducción con una petición simulada: el worker desplegado devuelve `template_parameter_missing` en `webinar_1h` con `name=null`; el código local utiliza `comunicador/a` y completa la petición simulada. No se hicieron envíos reales.
- Los 22 tests del procesador de seguimientos pasan.
- De 24 tests unitarios seleccionados, pasan 23 y falla uno en `booking-form.test.ts`: su fixture de preguntas no incluye los campos requeridos actuales `applicationReasons` y `admissionDecision`. Es un test pendiente de actualizar; no demuestra por sí solo un fallo del formulario público.
- No se ejecutó una inscripción y reserva reales con envío automático. Las pruebas locales no demuestran ese recorrido en producción.

## Orden para terminar la preparación

1. Alinear y aprobar las plantillas de los ocho mensajes, respetando la revisión manual de reservas.
2. Aplicar la migración de mensajes fijos y desplegar el worker actualizado, conservando los envíos reales apagados.
3. Sincronizar el catálogo y comprobar las vinculaciones de los ocho triggers.
4. Configurar el número real y comprobar vigencia y permisos del token de Supabase. Desactivar el modo de pruebas en el worker y en su configuración privada.
5. Revisar el test desactualizado y verificar con un contacto autorizado la inscripción, reserva con el mismo email, reprogramación, cancelación y enlace de Meet.
6. Activar el canal real y el interruptor del panel únicamente cuando se autorice la puesta en marcha. Comprobar la recepción en el móvil, sin reenviar resultados inciertos.

## Archivos principales

- [Procesador de seguimientos](../supabase/functions/process-followup-queue/worker.ts).
- [Migración pendiente de mensajes y triggers fijos](../supabase/migrations/20261009170000_fixed_whatsapp_automations.sql).
- [Trigger de inscripción actual](../supabase/migrations/20261009130000_two_stage_masterclass.sql).
- [Formulario de acceso y cualificación](../lib/leads/booking-handler.ts).
- [Receptor de reservas de Cal.com](../lib/followups/cal.ts).
- [Pantalla de mensajes y activación](../app/admin/whatsapp-form.tsx).
