# Webhooks de WhatsApp: implementación aplazada

Decisión del usuario: **9 de octubre de 2026**. Por ahora no configurar ni activar nuevas suscripciones de webhooks de WhatsApp. Este documento conserva el conocimiento para una futura implementación. No afecta a los webhooks de Cal.com.

Documentar esta decisión no desactiva configuraciones que ya existan en Meta ni modifica el código, los secretos o los interruptores de envío.

## Para qué los necesitaríamos

Los webhooks son avisos que Meta envía a nuestro servidor cuando sucede un evento. Para recibir respuestas se suscribe el campo `messages`.

| Evento | Uso en este proyecto | Estado del código consultado |
| --- | --- | --- |
| Una persona responde | Registrar la llegada de la respuesta y evitar el cierre de captación de tres días cuando ya haya respondido. No detiene por sí sola todos los mensajes. | Preparado; recepción real del número de producción pendiente de verificar. |
| Respuesta `BAJA` o `STOP` | Retirar el consentimiento de WhatsApp para impedir futuros envíos que dependan de ese consentimiento. | Preparado; recorrido real pendiente de verificar. |
| Respuesta `CONFIRMO` | Posible confirmación de asistencia a una llamada. | Pausado por decisión del usuario: actualmente se registra con `confirms: false`. |
| Estado de un mensaje: enviado, entregado, leído o fallido | Mostrar entrega real y diagnosticar fallos. | El receptor actual no persiste estos estados; requiere implementación adicional. |

No necesitamos webhooks para ejecutar un envío puntual desde el dashboard de Meta o mediante la API. Sí los necesitamos para que nuestra aplicación conozca y procese las respuestas automáticamente. La falta de esta recepción deja sin efecto las reglas que dependen de detectar respuestas o bajas por este canal.

Recibir una respuesta no implica contestarla automáticamente: el receptor actual no implementa un chatbot ni guarda el texto completo de la conversación.

## Código que ya existe

- [`app/api/webhooks/whatsapp/route.ts`](../app/api/webhooks/whatsapp/route.ts): receptor GET/POST y persistencia mediante el RPC `record_whatsapp_replies`.
- [`lib/followups/whatsapp.ts`](../lib/followups/whatsapp.ts): valida la firma `X-Hub-Signature-256`, filtra por el número de negocio configurado y procesa mensajes de texto y respuestas de botones.
- [`supabase/migrations/20261008000200_followup_event_guards.sql`](../supabase/migrations/20261008000200_followup_event_guards.sql): lógica de registro de respuestas y retirada de consentimiento. Los identificadores de mensajes permiten evitar procesamiento duplicado.
- [`docs/seguimiento.md`](seguimiento.md): configuración general y reglas de los seguimientos.

El receptor necesita en el servidor Next.js `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`. El endpoint previsto es `https://TU-DOMINIO/api/webhooks/whatsapp`. El GET valida el challenge de Meta; el POST verifica la firma sobre el cuerpo original.

Estas variables corresponden a la recepción. Las credenciales de envío de los workers de Supabase son una configuración separada. No guardar tokens, secretos o PIN en este documento ni en Git.

## Estado observado en Meta el 9 de octubre de 2026

Se consultó `whatsapp_business_tools` y se revisó el dashboard en el navegador. Este estado es una instantánea y debe consultarse de nuevo antes de retomar el trabajo.

| Elemento | Resultado observado |
| --- | --- |
| Empresa | Ignacio Roa, identificador `1102523378841182`. |
| Aplicación | Comunica con Autoridad, identificador `1820130342323172`. |
| Cuenta real | Nacho Roa, identificador `1407248797600706`; la API la devuelve aprobada. |
| Número real | `+34 601 17 19 82`, identificador `1341750885693622`; registrado en la API y «Conectado» en WhatsApp Manager. |
| Webhook a nivel de aplicación | Callback configurado y campo `messages` entre los campos suscritos. No se verificó aquí la URL del callback ni su recepción real. |
| Suscripción de la cuenta real a la aplicación | La consulta específica del número indicó que esta cuenta no envía sus eventos a Comunica con Autoridad. |
| Publicación de la aplicación | En desarrollo, sin publicar. Puede limitar la recepción de eventos reales; comprobar el comportamiento y los requisitos vigentes al retomarlo. |

La consulta general de incorporación indicó que alguna cuenta enviaba eventos a la aplicación, pero la consulta específica del número real indicó que su cuenta no estaba suscrita. Para diagnosticar un número hay que consultar su cuenta concreta, no extrapolar el estado general del negocio.

El selector «De» del formulario de envío de Meta se observó vacío. Su enlace a WhatsApp Manager abrió inicialmente «Test WhatsApp Business Account»; al seleccionar «Nacho Roa», el número real apareció conectado. Cambiar esa selección y recargar el formulario no hizo aparecer el número en el selector de envío. **La causa del selector vacío no quedó resuelta y no se demostró que configurar webhooks lo arregle.** No volver a registrar el número por ese síntoma.

## Al retomar la implementación

1. Confirmar qué funciones se quieren activar: respuestas, bajas, estados de entrega o confirmación de asistencia. `CONFIRMO` sigue pausado; tampoco hay autorización para cancelar plazas automáticamente.
2. Consultar otra vez el estado de la empresa, aplicación y número mediante `whatsapp_business_tools`. Usar la consulta específica del número para verificar la suscripción de su cuenta real.
3. Comprobar el endpoint público desplegado y sus variables, incluido que `WHATSAPP_PHONE_NUMBER_ID` corresponda al número real y no al de pruebas. Verificar el GET challenge y la validación de firmas.
4. Revisar el callback existente antes de cambiarlo. Configurar `messages` y suscribir la cuenta real a la aplicación correcta; son dos pasos distintos. Respetar las confirmaciones que exijan las herramientas para estas escrituras.
5. Revisar los requisitos de publicación de Meta. Un callback configurado, una suscripción guardada o un challenge correcto no prueban la recepción de respuestas reales.
6. Probar con un contacto autorizado: recepción y persistencia de una respuesta, duplicados, filtrado de otro número, supresión del cierre de tres días y baja con `BAJA`/`STOP`.
7. Si se retoma `CONFIRMO`, acordar si la aceptación debe reflejarse solo en el panel o también en Cal.com. Probar reservas ambiguas, reprogramaciones y respuestas antiguas antes de activarlo.
8. Si se añaden estados de entrega, implementar su persistencia por identificador de mensaje y probar eventos duplicados o fuera de orden. `sent` en los workers actuales significa aceptación por el proveedor, no entrega al teléfono. Mantener los resultados `delivery_unknown` para revisión manual, sin reenvíos automáticos.

## Referencias

- [Recepción de mensajes en la documentación de Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/receivingMessages/) — explicación del mecanismo; el SDK de esa página está archivado, no es una recomendación para instalarlo.
- [Configuración de la aplicación en Meta](https://developers.facebook.com/apps/1820130342323172/use_cases/customize/wa-configurations-v2/?business_id=1102523378841182&use_case_enum=WHATSAPP_BUSINESS_MESSAGING&selected_tab=wa-configurations-v2&product_route=whatsapp-business).
- [Número real en WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?asset_id=1407248797600706&business_id=1102523378841182&tab=phone-numbers&nav_ref=whatsapp_manager).
