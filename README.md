# Comunica con Autoridad

Aplicación Next.js con acceso a una masterclass por email, formulario de cualificación, copia a Google Sheets y reserva de llamada en Cal.com. Supabase guarda los contactos y programa el seguimiento por WhatsApp y correo; una Edge Function procesa ambos canales.

## Documentación

- [Triggers y horarios de envío](docs/triggers.md): referencia única de notificaciones, condiciones, cancelaciones, reintentos y estado comprobado de producción.
- [Configuración y despliegue](docs/activacion.md): entorno local, servicios, webhooks, cron, sandbox y comprobaciones.
- [Formulario de masterclass](docs/formulario-masterclass.md): las dos fases, persistencia, Sheets y apertura de Cal.com.
- [Administración](docs/administracion.md): acceso privado, contactos, llamadas y consulta de WhatsApp.
- [Analíticas](docs/analiticas.md): Vercel Analytics y atribución UTM.
- [Plantillas de correo](templates/README.md): edición y publicación en Resend.

## Empezar

```powershell
pnpm install
pnpm exec supabase start
```

Copiar `.env.example` a `.env.local` y configurar Supabase **local** y el secreto HMAC siguiendo la guía de configuración. La API usa `55321` y Postgres `55322`; las credenciales quedan en el servidor.

```powershell
pnpm dev
```

## Archivos principales

- `app/api/leads/access/route.ts` y `app/api/leads/qualification/route.ts`: acceso y cualificación.
- `lib/leads`: validación, persistencia, Sheets e idempotencia.
- `lib/followups`: webhooks de Cal.com/WhatsApp y bajas de correo.
- `supabase/migrations`: tablas, permisos, triggers, programación y cron.
- `supabase/functions/process-followup-queue`: procesador de WhatsApp y Resend.
- `app/admin`: panel privado con Supabase Auth y cuentas individuales, sin alta pública.

Los comandos de validación y sus límites están en [configuración](docs/activacion.md#validación-y-monitorización). `sent` significa aceptación por el proveedor; la entrega final necesita comprobación independiente. Los resultados `delivery_unknown` quedan para revisión manual.
