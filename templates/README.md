# Plantillas de seguimiento para Resend

Cuatro HTML completos e independientes, preparados para importar en Resend. Comparten una columna de 600 px, estilos esenciales en línea, ajustes móviles, fuentes de sistema, botón de reserva y enlace de baja. No necesitan imágenes, JavaScript, Tailwind ni archivos CSS externos.

## Borradores importados en Resend

Los cuatro HTML se importaron el 8 de octubre de 2026 mediante el plugin Resend, con remitente, asunto, variables y aliases configurados. Se comprobó que el HTML almacenado coincide con cada archivo local. En esa comprobación todas las plantillas tenían estado **draft**; aún no se han publicado ni conectado al envío activo.

| Paso | Alias | Borrador |
| --- | --- | --- |
| `email_1` | `email-1-claridad` | [Abrir Claridad](https://resend.com/templates/42827b24-7187-4518-bc04-41e804a1a357) |
| `email_2` | `email-2-casos` | [Abrir Casos](https://resend.com/templates/63a97b10-d130-4b8e-a614-ac69262b6d55) |
| `email_3` | `email-3-empezar` | [Abrir Empezar](https://resend.com/templates/8bb6b2b1-154c-4b6a-a102-56e5080fa590) |
| `email_4` | `email-4-resultados` | [Abrir Resultados](https://resend.com/templates/9e868249-86bf-4647-a0c1-5fa0a5e6025c) |

`resend-templates.json` conserva los IDs, aliases y archivos correspondientes. No controla el envío por sí mismo. Para estos borradores no hace falta repetir la importación descrita debajo.

Se han adaptado los archivos a los requisitos del importador MCP: todos los estilos están en línea, sin bloques `<style>` ni propiedades abreviadas. La columna es fluida y los márgenes interiores funcionan en móvil sin depender de media queries. Los borradores contienen HTML estático; convertirlos al editor visual puede alterar el formato.

| Archivo | Paso actual | Asunto | Momento |
| --- | --- | --- | --- |
| `email-1-claridad.html` | `email_1` | Quédate con esta idea de la masterclass que has visto. | +30 minutos |
| `email-2-casos.html` | `email_2` | Te presento a Santiago, María y Mateo. | +1 día |
| `email-3-empezar.html` | `email_3` | Esto es lo que me dice la mayoría de la gente: | +2 días |
| `email-4-resultados.html` | `email_4` | Transferencia recibida. | +3 días |

## Importar

1. En Resend, abre **Templates → Create template**.
2. Arrastra el HTML al editor o pega su contenido completo. Cada archivo corresponde a una plantilla diferente.
3. Configura el remitente `Ignacio Roa <ignacio@comunicaconautoridad.com>` con el dominio verificado y el asunto de la tabla. El `<title>` del HTML no configura el asunto del envío.
4. Define las variables indicadas a continuación como tipo `string`. Comprueba que Resend las reconoce tras importar el HTML.
5. Usa valores de prueba para previsualizar y envía una prueba a tu propio buzón. Revisa el resultado en móvil, el botón y el enlace de baja.
6. Publica cada plantilla cuando esté revisada y conserva su ID o alias para conectarla al paso correspondiente.

[Guía oficial para importar HTML](https://resend.com/docs/dashboard/templates/create-template#add-a-template-from-an-existing-file).

## Variables

La sintaxis del HTML es `{{{VARIABLE}}}`, con tres llaves, según la [documentación de Resend](https://resend.com/docs/dashboard/templates/template-variables).

| Variable | Plantillas | Valor |
| --- | --- | --- |
| `LEAD_NAME` | Solo email 2 | Nombre del destinatario; obligatorio en ese envío, sin valor por defecto. |
| `BOOKING_URL` | Todas | URL de reserva. Puede tener como valor por defecto el enlace de Cal.com indicado debajo. |
| `EMAIL_UNSUBSCRIBE_URL` | Todas | URL HTTPS de baja firmada para ese registro; obligatoria en cada envío, sin valor por defecto. |

Valor por defecto de `BOOKING_URL`:

```text
https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
```

Se usa `EMAIL_UNSUBSCRIBE_URL` porque `UNSUBSCRIBE_URL` es un nombre reservado por Resend. Debe recibir el enlace de baja que ya genera nuestro sistema, conservando su token y su pantalla de confirmación. No sustituirlo por un enlace genérico ni reutilizar un token entre destinatarios.

Al abrir los HTML directamente en el navegador se ven las variables sin resolver. Esto es normal; Resend las reemplaza al enviar con la plantilla y sus valores.

## Contenido y conexión

Los textos parten de `lib/followups/messages.json`. Se han separado párrafos, convertido enumeraciones en listas, destacado frases y sustituido las URLs visibles por botones o enlaces con texto. Se han corregido espacios, puntuación, el acento de María y la mención de Álvaro para que el caso de Mateo sea consistente con su encabezado y asunto.

El email 4 conserva los **35 minutos** del original. Los recordatorios de WhatsApp mencionan **45 minutos**; conviene unificar la duración antes de publicar la secuencia. No se ha añadido ninguna captura de transferencias ni testimonio nuevo.

Estos archivos no cambian el envío activo. La función `supabase/functions/process-followup-queue/worker.ts` sigue enviando texto plano. Para usar las plantillas publicadas habrá que asignar cada ID o alias a su paso y adaptar la llamada a Resend para incluir `template.id` y `template.variables`, en lugar del cuerpo de texto actual. El nombre se obtiene de `message.name` y el enlace de baja de la URL firmada que ya construye la función.

La importación, publicación y entrega en clientes de correo deben verificarse en Resend; una previsualización local no confirma ese comportamiento.

## Verificación local

Los cuatro HTML se han renderizado en Chromium con variables de ejemplo a 320, 390, 600 y 1024 px, sin desbordamiento horizontal y con enlaces HTTPS, también después de la adaptación al importador MCP. Se revisó visualmente la versión inicial del primer email en escritorio y del segundo en móvil. El contraste de texto, pie y botón supera 4,5:1. No se ha realizado un envío ni comprobado el renderizado en Gmail, Outlook o el editor de Resend.
