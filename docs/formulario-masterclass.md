# Formulario de la masterclass en dos fases

1. «Acceder gratis a la masterclass» pide solo el email y muestra junto a él la casilla opcional, inicialmente desmarcada, para los cuatro emails de seguimiento. El acceso al vídeo no depende de marcarla.
2. «Continuar» guarda el email en Supabase, registra la inscripción y muestra el vídeo. Si se aceptaron los emails, se programan `email_1` a `email_4` a los 30 minutos, 1 día, 2 días y 3 días desde esta inscripción. Antes de cada envío se comprueba de nuevo el consentimiento y la baja.
3. Bajo el vídeo, el segundo formulario pide nombre y móvil de WhatsApp, seguidos de las seis preguntas existentes: profesión, objetivo, compromiso, inversión, tres razones y decisión de admisión. El aviso visible indica que al enviarlo se aceptan los tres WhatsApp de seguimiento de la clase, incluida una invitación a reservar, y los avisos de una llamada reservada. El botón final menciona expresamente WhatsApp. No hay casilla de WhatsApp. «BAJA» y «STOP» detienen sus envíos pendientes.
4. Al enviar el segundo formulario se guardan el contacto y las respuestas en la misma inscripción, se programan los WhatsApp desde ese momento y se copia la ficha completa a Google Sheets. Solo la decisión afirmativa abre Cal.com en otra pestaña, tras confirmar ambos guardados; la masterclass sigue abierta en la pestaña original. Se reserva una pestaña en blanco al pulsar el botón para evitar bloqueos del navegador y se cierra si falla el guardado. «Abrir calendario» también utiliza otra pestaña y permite acceder si el navegador bloqueó la apertura automática. Si Sheets falla, Supabase conserva los datos y se puede reintentar con la misma inscripción.
5. Las reservas de Cal.com se vinculan por el mismo email. Si una reserva llega antes de que la persona facilite su móvil, sus WhatsApp se programan cuando complete el segundo formulario. Los correos propios de Cal.com se configuran y envían en Cal.com; la aplicación no les aplica el consentimiento de los cuatro emails de seguimiento.

El navegador conserva las marcas de acceso y una referencia firmada válida durante 30 días; no guarda email, móvil ni respuestas. Una inscripción anterior sin referencia, o una referencia caducada, requiere completar el acceso otra vez. «Realizar otra inscripción» borra la referencia anterior.

La primera fase ya no llama a Google Sheets: el Apps Script existente exige teléfono. La segunda fase envía todos los datos y requiere `success: true` con `duplicate: false` para una fila nueva o `updated: true` para una fila existente antes de desbloquear Cal.com. Una inscripción que no complete esta fase queda registrada en Supabase y no aparece en Sheets. Una respuesta de duplicado sin `updated: true` no acredita la actualización.

## Puesta en producción

- Aplicar `20261012000100_restore_followup_schedule.sql`, `20261012000200_email_first_masterclass.sql` y `20261012000300_existing_contact_whatsapp_acceptance.sql`, en ese orden, sin modificar migraciones anteriores.
- Desplegar la aplicación que utiliza las RPC `submit_masterclass_email_access` y `complete_masterclass_qualification_with_contact`.
- Comprobar en Cal.com que sus propias confirmaciones y recordatorios por email estén activados. Esta aplicación no los envía ni controla su entrega.
- Verificar con un registro de prueba la persistencia de ambas fases, la copia a Sheets, la programación de trabajos y la recepción real en los proveedores. Un estado `sent` acredita aceptación por el proveedor, no entrega final.
