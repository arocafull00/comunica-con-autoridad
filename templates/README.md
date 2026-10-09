# Plantillas de seguimiento para Resend

Cuatro HTML completos e independientes, preparados para importar en Resend. Comparten una columna de 600 px, estilos esenciales en línea, ajustes móviles, fuentes de sistema, botón de reserva y enlace de baja. Incluyen las fotos originales de Santiago, María y Mateo, con una cabecera negra y acentos cobre como la web. No necesitan JavaScript, Tailwind ni archivos CSS externos.

## Plantillas publicadas en Resend

Los cuatro HTML se importaron el 8 de octubre de 2026 mediante el plugin Resend, con remitente, asunto, variables y aliases configurados. Se comprobó que el HTML almacenado coincide con cada archivo local. El 9 de octubre de 2026 se actualizaron con las fotografías, se publicaron las cuatro y se desplegó `process-followup-queue` para usarlas en los próximos envíos automáticos. Se verificaron sus estados **published**, las variables y sus alternativas de texto.

| Paso | Alias | Plantilla |
| --- | --- | --- |
| `email_1` | `email-1-claridad` | [Abrir Claridad](https://resend.com/templates/42827b24-7187-4518-bc04-41e804a1a357) |
| `email_2` | `email-2-casos` | [Abrir Casos](https://resend.com/templates/63a97b10-d130-4b8e-a614-ac69262b6d55) |
| `email_3` | `email-3-empezar` | [Abrir Empezar](https://resend.com/templates/8bb6b2b1-154c-4b6a-a102-56e5080fa590) |
| `email_4` | `email-4-resultados` | [Abrir Resultados](https://resend.com/templates/9e868249-86bf-4647-a0c1-5fa0a5e6025c) |

`resend-templates.json` conserva los IDs, aliases, archivos y URLs de las fotos. El worker selecciona el alias correspondiente a cada paso. Para estas plantillas no hace falta repetir la importación descrita debajo: actualizar el HTML y volver a publicar el ID existente.

Se han adaptado los archivos a los requisitos del importador MCP: todos los estilos están en línea, sin bloques `<style>` ni propiedades abreviadas. La columna es fluida y los márgenes interiores funcionan en móvil sin depender de media queries. Las plantillas contienen HTML estático; convertirlos al editor visual puede alterar el formato.

| Archivo | Paso actual | Asunto | Momento |
| --- | --- | --- | --- |
| `email-1-claridad.html` | `email_1` | Quédate con esta idea de la masterclass que has visto. | +30 minutos |
| `email-2-casos.html` | `email_2` | Te presento a Santiago, María y Mateo. | +1 día |
| `email-3-empezar.html` | `email_3` | Esto es lo que me dice la mayoría de la gente: | +2 días |
| `email-4-resultados.html` | `email_4` | Transferencia recibida. | +3 días |

## Importar en otra cuenta

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

El email 4 conserva los **35 minutos** del original. Los recordatorios de WhatsApp mencionan **45 minutos**; queda pendiente unificar esa duración con el cliente. No se ha añadido ninguna captura de transferencias ni testimonio nuevo.

La función `supabase/functions/process-followup-queue/worker.ts` envía `template.id` y `template.variables`, sin combinar la plantilla con `html` o `text` (Resend rechaza esa combinación). El nombre se obtiene de `message.name` y se escapa antes de insertarlo en el segundo correo; el enlace de baja conserva su firma HMAC. `BOOKING_URL` utiliza el valor por defecto de las plantillas. Las actualizaciones futuras del HTML solo necesitan publicarse en Resend mientras se mantengan los aliases y variables. Un paso desconocido no envía una plantilla incorrecta.

La importación, publicación y entrega en clientes de correo deben verificarse en Resend; una previsualización local no confirma ese comportamiento.

## Verificación local

La versión con fotos se ha revisado en navegador con variables de ejemplo a 320, 375 y 1067 px efectivos, sin desbordamiento horizontal y con las tres imágenes públicas cargadas en cada correo. Se guardaron capturas del correo de casos en escritorio y móvil. El contraste de texto, pie y botón supera 4,5:1. Pasaron lint, la comprobación Deno y los 21 tests del worker, incluida la selección de los cuatro aliases, la baja firmada, los nombres con HTML y la prevención de duplicados. No se realizó un envío de prueba ni se verificó el renderizado en Gmail u Outlook.

## Fotografías

Las fotos originales están en `public`. Para que un correo ya enviado siga mostrando sus imágenes aunque cambie la web, se alojan también en el bucket público `email-assets` de Supabase, con nombres basados en su contenido y sin sobrescritura. El bucket solo admite JPEG de hasta 1 MB; las escrituras requieren credenciales privadas del servidor. No se añadieron permisos de escritura para usuarios ni visitantes.

Para cambiar las fotos:

1. Aplicar la migración `20261009000100_email_assets_bucket.sql` en el entorno correspondiente, si aún no existe el bucket.
2. Ejecutar `node --env-file=.env.local scripts/upload-email-assets.mjs`. Verifica la descarga pública de cada original y actualiza los HTML y el manifiesto.
3. Revisar las cuatro plantillas en escritorio y móvil. Conservar tablas de presentación, estilos inline, imágenes con dimensiones y texto alternativo, y las variables de reserva y baja.
4. Actualizar los IDs existentes en Resend con cada HTML y volver a publicar. Una edición en borrador no cambia los próximos envíos.

No reiniciar trabajos anteriores ni enviar pruebas a contactos reales sin autorización.
