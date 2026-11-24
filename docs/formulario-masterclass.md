# Formulario de la masterclass

1. La clase se muestra desde la primera visita. Al terminar el primer vídeo se desbloquea la versión que se puede revisar libremente.
2. «Agendar llamada» abre el paso de contacto con nombre, email y móvil. «Continuar» pasa a las tres preguntas sobre profesión, situación actual y objetivo.
3. «Reservar llamada» envía el formulario completo a `POST /api/leads/qualification`. La ruta valida los datos y usa el Apps Script de Google Sheets para guardarlos con un identificador de envío. Ante un error, el formulario mantiene los valores y reutiliza el identificador para reintentar el mismo envío.
4. Mientras se guarda el formulario, la página muestra «Guardando…». Tras la confirmación de Sheets, Cal.com se abre en la misma pestaña. Al volver a la masterclass, «Agendar consultoría gratuita» da acceso directo al calendario.

El contacto y las respuestas permanecen en memoria hasta el envío. Si se recarga la página antes de completarlo, se empieza de nuevo. El navegador solo conserva las marcas de vídeo desbloqueado y formulario completado. «Realizar otra inscripción» borra la marca de formulario completado.

El endpoint de Apps Script puede configurarse en `GOOGLE_SHEETS_ENDPOINT`. El contrato se describe en [el script de Google Sheets](../scripts/google-sheets-masterclass.gs).
