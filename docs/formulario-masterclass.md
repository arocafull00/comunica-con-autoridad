# Formulario de la masterclass: contacto y preguntas

Esta guía describe acceso, guardado y navegación. Todos los horarios y condiciones de notificaciones están en [triggers.md](triggers.md).

1. La clase se muestra desde la primera visita, sin registro. Al terminar el primer vídeo se desbloquea la versión que se puede revisar libremente; esa marca se guarda en el navegador.
2. Bajo el vídeo aparece «Agendar llamada». Al pulsarlo se abre un paso con nombre, email y número de WhatsApp (solo móviles) y dos casillas independientes, opcionales y desmarcadas: emails y WhatsApp. Se puede reservar sin aceptar ninguna.
3. «Continuar» guarda el contacto y sus consentimientos con `POST /api/leads/access` (RPC `submit_masterclass_contact`), antes de las preguntas. En esa misma transacción se crea o reutiliza la inscripción del email y se inician solo los seguimientos autorizados, sin reiniciar los existentes. Un consentimiento dado antes con el mismo email (y, para WhatsApp, el mismo móvil) sigue vigente hasta que se retire con la baja o `BAJA`.
4. Las preguntas son siete: profesión, «¿En qué punto te encuentras actualmente?» (las cinco opciones de siempre), qué quiere mejorar, compromiso, inversión, candidatura («Seleccionamos cuidadosamente a las personas con las que trabajamos. ¿Por qué consideras que deberíamos elegir tu candidatura para formar parte del programa?») y decisión de admisión.
5. El último botón muestra «Reservar llamada» para la decisión afirmativa y «Guardar respuestas» para la otra. `POST /api/leads/qualification` (RPC `complete_masterclass_candidate_qualification`) guarda las respuestas en el mismo contacto, sin tocar los consentimientos, y después copia la ficha completa a Google Sheets, incluida `situacion_actual`. Un fallo de Sheets no revierte lo guardado en Supabase.
6. Solo la decisión afirmativa abre Cal.com en otra pestaña, tras confirmar los guardados de Supabase y Sheets; la masterclass sigue abierta. Se reserva una pestaña en blanco al pulsar para evitar bloqueos y se cierra si falla el guardado. «Abrir calendario» permite acceder si el navegador bloqueó la apertura automática.

El paso de contacto no llama a Sheets: un contacto que no responde las preguntas existe en Supabase, pero no aparece en Sheets. La segunda llamada envía `submission_id`, nombre, respuestas, email, teléfono, país y prefijo; exige `success: true` y una fila nueva (`duplicate: false`) o una actualización confirmada (`updated: true`). Ante un fallo se puede reintentar con la misma inscripción.

**Compatibilidad.** Las rutas y RPC anteriores siguen disponibles: una página antigua puede enviar solo el email a `POST /api/leads/access` (`submit_masterclass_email_access`) y después nombre, móvil y seis respuestas a `POST /api/leads/qualification` (`complete_masterclass_qualification_with_contact`, que registra el consentimiento WhatsApp implícito de entonces). El servidor distingue el formato por los campos recibidos. Una referencia guardada de una inscripción solo con email vuelve al paso de contacto.

No se exige reproducir o terminar el vídeo para programar envíos. La reserva se vincula por el mismo email. Los casos de reserva previa al móvil, repetición de email y baja se explican en [triggers.md](triggers.md).

El navegador conserva la marca de vídeo completado y una referencia firmada válida durante 30 días; no guarda email, móvil ni respuestas. Sin referencia, o con una referencia caducada, se vuelve a mostrar «Agendar llamada». «Realizar otra inscripción» borra la referencia anterior.

Para desplegar otro entorno, aplicar todas las migraciones pendientes y publicar la aplicación con las RPC `submit_masterclass_contact` y `complete_masterclass_candidate_qualification` (las anteriores se conservan). Seguir [activación](activacion.md) para configurar servicios y comprobar ambas fases, copia a Sheets y navegación. Los correos propios de Cal.com se configuran en Cal.com.
