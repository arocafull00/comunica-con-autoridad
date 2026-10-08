# Comunica con Autoridad

Next.js con un formulario de captación, API de leads y seguimiento por email mediante Supabase Postgres, Cron y Edge Functions. La bienvenida antigua de WhatsApp utiliza PGMQ y otra Edge Function. Ver [configuración del seguimiento](docs/seguimiento.md).

El consentimiento es opcional: todas las solicitudes válidas se guardan; solo las consentidas generan un mensaje. Los envíos reales y su Cron están desactivados por defecto.

La portada reproduce `reference/template.html`: formulario de seis pasos, selector internacional de móvil, acceso a Wistia y reserva en Cal.com. Las seis respuestas se guardan juntas en Supabase y se consultan en Contactos. El acceso y la finalización del primer vídeo se recuerdan en este navegador, sin guardar datos personales en localStorage. El vídeo libre se desbloquea al finalizar el primero. Como la referencia no solicita consentimiento para mensajes de WhatsApp, este formulario envía `whatsappConsent: false` y no genera bienvenidas.

Antes de desplegar esta versión, aplicar la nueva migración `20261007000700_masterclass_answers.sql` en la base de datos de destino. En local, ejecutar `pnpm exec supabase migration up --local`.

La portada utiliza `/api/leads`: primero guarda en Supabase y después copia las seis respuestas al mismo Apps Script de Google Sheets de `reference/template.html`, con los nombres de campo originales y país/prefijo del teléfono. `GOOGLE_SHEETS_ENDPOINT` permite cambiar el destino desde el servidor; si no se configura, utiliza el original. El acceso solo se confirma cuando Apps Script responde `success: true`, también si reconoce un duplicado. Si Google falla, los datos permanecen en Supabase y el usuario puede reintentar con el mismo `submission_id` sin crear otro contacto. No se utiliza Netlify Forms.

## Empezar

```powershell
pnpm install
pnpm exec supabase start
```

Copiar `.env.example` a `.env.local` y configurar las credenciales **locales** de Supabase y el secreto HMAC, siguiendo [la guía de configuración y activación](docs/activacion.md).

```powershell
pnpm dev
```

La API local de Supabase usa el puerto `55321` y Postgres `55322`. No hay credenciales en el navegador.

## Verificar

```powershell
pnpm test
pnpm test:worker
pnpm test:db
pnpm lint
pnpm typecheck
pnpm check:worker
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:browser:local
```

Las suites de navegador deben ejecutarse sucesivamente. Las pruebas de base de datos requieren Supabase local; las del worker simulan Meta. La suite de integración local sustituye Apps Script por un servidor de prueba en `3102` para comprobar el envío sin escribir en la hoja real. La guía detalla las diferencias entre pruebas locales, simuladas y reales, el contrato de la API y el procedimiento de despliegue y activación.

## Archivos principales

- `app/api/leads/route.ts`: recepción de solicitudes.
- `lib/leads`: validación, tamaño de cuerpo, HMAC e idempotencia.
- `supabase/migrations`: tablas, permisos, triggers, cola, worker y Cron.
- `supabase/functions/process-whatsapp-queue`: envío, clasificación de errores y procesamiento de trabajos.
- `docs/activacion.md`: configuración, activación, monitorización y revisión manual.

El estado `sent` significa que Meta aceptó la petición; esta versión no verifica entrega ni lectura. Un resultado incierto queda detenido como `failed / delivery_unknown` para revisión manual.

## Analíticas

Vercel Web Analytics mide el tráfico y el evento `lead_submitted` marca solicitudes nuevas guardadas. Supabase ofrece informes privados por período de solicitudes, correos únicos y campañas UTM. Consultar [activación y consultas de analíticas](docs/analiticas.md); la recogida real en Vercel requiere activar Analytics y desplegar. Los eventos personalizados necesitan Pro o Enterprise.

## Administración

Panel privado en `/admin`: resumen, contactos, configuración de la bienvenida de WhatsApp y cambio de contraseña. Acceso con Supabase Auth y cuentas administrativas individuales, sin alta pública. Consultar [creación de cuentas y configuración del panel](docs/administracion.md). La selección de plantilla ahora se guarda en Postgres; sincronizar el catálogo aprobado y actualizar el worker antes de activar envíos.
