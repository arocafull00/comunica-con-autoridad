# Formulario de la masterclass en dos fases

1. «Acceder gratis a la masterclass» abre nombre, WhatsApp y email, con dos consentimientos independientes, opcionales y desmarcados. El nombre es obligatorio, admite entre 2 y 100 caracteres y se guarda tanto en Supabase como en Google Sheets.
2. «Continuar» guarda el contacto, confirma Google Sheets, registra la inscripción y muestra el vídeo.
3. «Reservar llamada», bajo el vídeo, abre seis preguntas: profesión, objetivo, compromiso, inversión, tres razones para reservar y decisión de admisión. Cada pregunta requiere una respuesta; se puede volver atrás.
4. Al confirmar las seis respuestas se actualiza el mismo contacto y la misma fila de Sheets. Solo entonces aparece el enlace «Reservar llamada» a Cal.com.

Una pestaña abierta con el formulario anterior de cuatro preguntas recibe un 400 que pide recargar la página para completar las dos preguntas nuevas. No se guardan respuestas incompletas. Al recargar se conserva el acceso, pero hay que volver a completar las respuestas.

La inscripción y los plazos del seguimiento comienzan con la primera fase. Contestar las preguntas no crea otro contacto, no vuelve a dar consentimiento y no reinicia las automatizaciones. No se exige terminar el vídeo para reservar. Los contactos antiguos y sus respuestas siguen conservados. Las inscripciones anteriores sin nombre conservan su valor NULL y las plantillas que requieren un saludo usan «comunicador/a» cuando falta.

El navegador conserva únicamente las marcas de acceso y una referencia firmada de inscripción válida durante 30 días; no guarda correo, móvil ni respuestas. Una inscripción anterior sin referencia, o una referencia caducada, requiere completar los datos de acceso antes de las preguntas. «Realizar otra inscripción» borra las marcas y la referencia anterior.

## Puesta en producción

- Aplicar las migraciones `20261009130000_two_stage_masterclass.sql` y `20261009150000_admission_questions.sql` después de las anteriores.
- Aplicar `20261009210000_masterclass_access_name.sql` antes de desplegar la aplicación que recoge el nombre en la primera fase.
- Actualizar el Apps Script de la hoja con `scripts/google-sheets-masterclass.gs`, configurar las propiedades `MASTERCLASS_SPREADSHEET_ID` y `MASTERCLASS_SHEET_NAME` (opcional) y publicar una nueva versión de la implementación web. Si cambia la URL, actualizar `GOOGLE_SHEETS_ENDPOINT`. El script conserva las columnas ajenas al formulario, añade las que faltan y busca la fila por `submission_id`; revisar los nombres de las cabeceras existentes antes de publicarlo.
- Desplegar la aplicación y los workers `process-whatsapp-queue` y `process-followup-queue` para admitir contactos sin nombre. Esto no habilita envíos ni reintenta mensajes fallidos.

La segunda fase exige `success: true, updated: true` del Apps Script. El acuse antiguo `duplicate: true` por sí solo no demuestra que se hayan añadido las respuestas y no desbloquea Cal.com. Ante un fallo de Sheets, Supabase conserva los datos y el reintento completa la copia con la misma inscripción.

Las pruebas locales usan Supabase local y una hoja simulada; no prueban la implementación remota de Apps Script ni crean reservas reales.
