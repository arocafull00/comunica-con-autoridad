# Visitas, solicitudes y conversión

La web integra Vercel Web Analytics para visitantes, páginas vistas, procedencia, dispositivos y países, y Speed Insights para medir el rendimiento real de la página. Supabase conserva el recuento de solicitudes realmente guardadas y de correos distintos.

## Activar y consultar visitas

En el proyecto de Vercel, abrir **Analytics → Enable** y desplegar la versión que contiene esta integración. Después de recibir visitas, consultar las métricas en ese panel. El componente `WebAnalytics` se carga desde el layout y no modifica el formulario ni solicita sus datos.

Para las métricas de rendimiento, activar también **Speed Insights**. El mismo componente incorpora el SDK oficial `@vercel/speed-insights/next`. Ambos colectores miden únicamente la portada pública y eliminan los parámetros y fragmentos de las URLs antes de enviar datos; las rutas del panel y los enlaces de acceso quedan excluidos. Los resultados de rendimiento se consultan en **Speed Insights** del proyecto de Vercel.

Los eventos personalizados, incluido `lead_submitted`, requieren un plan Pro o Enterprise. No se ha cambiado el plan de la cuenta. Si solo se utilizan las visitas disponibles en el plan actual, las solicitudes y correos únicos siguen consultándose en Supabase.

En desarrollo, el SDK utiliza su modo de depuración, con logs desactivados; en un build local de producción, las rutas del colector de Vercel no existen. Por tanto, localhost no acredita recogida real de datos. Las pruebas de navegador sustituyen el script del colector por una simulación local, sin descargarlo ni enviar peticiones a Vercel.

## Qué se cuenta como conversión

`lead_submitted` se registra únicamente cuando `/api/leads` responde **201** y confirma que ha guardado una solicitud nueva. No se registra al pulsar el botón, al fallar una petición ni ante **200** de una repetición ya guardada. El evento lleva solo ese nombre fijo, sin propiedades del lead.

El fallo o bloqueo de Analytics no altera la confirmación de la solicitud. Los bloqueadores, conexiones interrumpidas o una respuesta 201 que no llegue al navegador pueden impedir registrar el evento. Una repetición 200 tampoco intentará compensarlo para evitar duplicar conversiones.

El número fiable de solicitudes es el de Supabase. Los visitantes de Vercel son una estimación del tráfico medido; los correos únicos no equivalen necesariamente a personas únicas. Para comparar la conversión, utilizar el mismo período y zona horaria. La proporción `solicitudes / visitantes × 100` es orientativa y puede incluir varias solicitudes de una misma persona; no debe presentarse como una tasa exacta de visitantes que dejan sus datos.

## Consultar solicitudes y correos únicos en Supabase

La nueva migración añade `get_lead_metrics(p_start, p_end)`, accesible desde SQL administrativo o un servidor con `service_role`. El cliente puede consultar este informe en `/admin` mediante su cuenta autorizada; ver [administración](administracion.md). No hay una ruta pública de estadísticas ni acceso directo para `anon` o `authenticated`.

Los límites son días de calendario en **Europe/Madrid**: inicio incluido, fin excluido. El rango debe tener entre uno y 366 días. Solo se cuentan leads con `source = 'web'`.

Últimos treinta días, incluido hoy, desde el SQL Editor de Supabase:

```sql
select public.get_lead_metrics(
  (now() at time zone 'Europe/Madrid')::date - 29,
  (now() at time zone 'Europe/Madrid')::date + 1
);
```

Para ver únicamente el resumen en una tabla:

```sql
with report as (
  select public.get_lead_metrics(
    (now() at time zone 'Europe/Madrid')::date - 29,
    (now() at time zone 'Europe/Madrid')::date + 1
  ) as metrics
)
select
  (metrics->>'leads')::bigint as solicitudes,
  (metrics->>'unique_emails')::bigint as correos_unicos,
  (metrics->>'whatsapp_consents')::bigint as consentimientos_whatsapp
from report;
```

La respuesta completa incluye:

- `leads`: solicitudes del período; las repeticiones con la misma clave no crean filas nuevas.
- `unique_emails`: correos distintos del período, normalizados con minúsculas y sin espacios exteriores.
- `whatsapp_consents`: solicitudes cuyo consentimiento WhatsApp está actualmente activo.
- `daily`: totales por día con actividad. Los días sin solicitudes se omiten; un período vacío devuelve cero y listas vacías.
- `campaigns`: totales agrupados por fuente, medio y campaña UTM, incluyendo el grupo sin etiquetas.

Los correos únicos del total se calculan para todo el período; sumar los correos únicos diarios puede contar varias veces a alguien que escribió en varios días.

Para aplicar la migración en otro entorno, seguir el procedimiento de revisión y despliegue de [activación](activacion.md). Los clientes anteriores que no envían UTM siguen funcionando.

## Campañas

Usar etiquetas de campaña no personales en los enlaces publicados, por ejemplo:

```text
https://TU-DOMINIO/?utm_source=instagram&utm_medium=paid&utm_campaign=curso_octubre
```

El formulario captura `utm_source`, `utm_medium` y `utm_campaign` de la URL que está abierta al enviarlo, y los guarda como `utm_source`, `utm_medium` y `utm_campaign` en el lead. No se registra una sesión de atribución, una primera visita ni un recorrido entre dispositivos.

Cada etiqueta se limita a cien caracteres y se eliminan caracteres de control al capturarla. Sin etiquetas, las columnas son `null`. La API admite los campos opcionales `utmSource`, `utmMedium` y `utmCampaign`, además del contrato anterior. La atribución participa en la comparación de idempotencia; cambiarla con una clave ya guardada devuelve 409.

## Datos personales

Nombres, emails, teléfonos, claves de idempotencia y etiquetas UTM no se incluyen en `lead_submitted`. Antes de enviar vistas o eventos, se eliminan la query, el fragmento y las credenciales de la URL; solo se mide la ruta pública `/`. También se configura `Referrer-Policy` mediante el metadato `strict-origin` para que el navegador envíe como referrer únicamente el origen, sin parámetros.

Los datos de contacto y las etiquetas de campaña permanecen en las tablas protegidas de Supabase. Usar UTM para describir campañas, nunca para introducir identificadores personales. Esta implementación no incluye replay de sesiones ni grabaciones del formulario.

Referencias: [configuración de Vercel Analytics](https://vercel.com/docs/analytics/quickstart), [eventos personalizados y planes](https://vercel.com/docs/analytics/custom-events), [beforeSend](https://vercel.com/docs/analytics/package#beforesend).
