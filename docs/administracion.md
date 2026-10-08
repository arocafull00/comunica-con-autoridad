# Panel del cliente

El panel está integrado en la misma aplicación, en `/admin`. Incluye Resumen, Contactos, WhatsApp y Mi cuenta. No hay registro público ni una contraseña compartida entre administradores.

## Preparar el entorno

1. Aplicar todas las migraciones nuevas. Localmente: `pnpm exec supabase migration up --local`. Para producción, revisar el destino y el dry-run siguiendo [activación](activacion.md).
2. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `LEAD_IP_HMAC_SECRET` y `ADMIN_SITE_URL` en el servidor de Next.js. La anon key (o publishable key compatible con Auth) también se usa exclusivamente en el servidor; no necesita `NEXT_PUBLIC_`.
3. En Supabase Auth, **desactivar Allow new users to sign up**, establecer la Site URL del dominio real y permitir `https://TU-DOMINIO/admin/accept`. El config local ya desactiva el registro. No existe una pantalla de alta pública.
4. Desplegar Next.js. Las cookies de sesión son HttpOnly, SameSite=Lax y Secure en producción, con alcance `/admin`. `ADMIN_LOCAL_HTTP` debe quedar sin definir en producción; el helper de preview local lo establece exclusivamente para HTTP en localhost.

La autenticación utiliza Supabase Auth; la autorización consulta `admin_accounts.active` en cada lectura y acción, además de verificar el usuario con Auth. Ser un usuario autenticado no permite leer tablas de leads o configuración. Sus permisos siguen revocados. Las consultas privadas y las llamadas a Vercel se realizan en el servidor. El panel no se almacena en cachés compartidas, no se indexa y no envía sus páginas o búsquedas a Analytics.

## Crear el acceso y pasarlo por privado

No se envían emails desde el script. El propietario genera un enlace de un solo uso y lo entrega personalmente al cliente. Usar el email real de cada administrador. Desde una terminal privada con las variables del entorno elegido:

```powershell
node --env-file=.env.local scripts/admin.mjs invite cliente@example.com
```

El script crea la cuenta y su autorización administrativa, y muestra un enlace a `/admin/accept`. El cliente elige una contraseña de 12 a 128 caracteres y entra en `/admin/login`. Abrir el enlace con GET no lo consume: se verifica al enviar el formulario. No publicar el enlace, guardarlo en Git ni pegarlo en logs compartidos; concede acceso a esa cuenta. Su caducidad depende de la configuración OTP de Supabase Auth (una hora en local).

Para una cuenta existente que olvidó la contraseña:

```powershell
node --env-file=.env.local scripts/admin.mjs recovery cliente@example.com
```

Para retirar el acceso, incluso a una sesión ya iniciada:

```powershell
node --env-file=.env.local scripts/admin.mjs revoke cliente@example.com
```

La siguiente lectura o modificación se denegará. Los datos que el navegador ya recibió no pueden retirarse retroactivamente. El script no reactiva una cuenta revocada mediante recuperación. Para reactivarla, el propietario debe revisar y cambiar su membresía en Supabase. El cliente puede cambiar su contraseña desde Mi cuenta, indicando la actual.

Login tiene un límite compartido en Postgres de diez intentos en diez minutos por HMAC de IP, además de los límites de Supabase Auth. Solo se confía en la IP de Vercel; fuera de Vercel se usa un único grupo local. Ver [activación](activacion.md) antes de usar otro hosting.

## Estadísticas y contactos

El resumen consulta el informe privado de Supabase: solicitudes, correos únicos, consentimiento, evolución diaria y campañas. El período usa días de Europe/Madrid; Desde se incluye y Hasta se excluye. El valor por defecto incluye hoy y los 29 días anteriores. Se aceptan hasta 366 días. La gráfica diaria compara solicitudes y correos únicos, incluyendo como cero los días sin actividad. Un período sin solicitudes muestra un estado vacío. El total de correos únicos del período no es la suma de los únicos diarios.

El dashboard usa componentes de shadcn/ui y gráficas basadas en Recharts, con la paleta de negro cálido, marfil y ámbar. Las gráficas ofrecen detalles al pasar el cursor; los datos diarios también se pueden consultar como texto. La gráfica de campañas muestra hasta seis y el listado conserva el detalle completo. Los componentes están en `components/ui`, su configuración en `components.json` y los colores se limitan al panel en `app/admin/admin.css`.

Contactos muestra 25 solicitudes por página, sus datos, consentimiento y atribución. Permite fechas y búsqueda por email. Solo se incluyen solicitudes de origen web. El total de correos únicos del período no es la suma de los únicos diarios.

Para añadir las visitas reales al resumen, activar Vercel Analytics en el proyecto y configurar, solo en Next.js:

Activar Analytics y añadir su SDK permite recoger visitas y consultarlas en Vercel. La consulta desde este panel es una conexión adicional: necesita un token de acceso a la API y los identificadores del proyecto y del equipo. Sin esa configuración, el panel muestra un aviso específico aunque el colector público esté funcionando.

```dotenv
VERCEL_ANALYTICS_TOKEN=
VERCEL_ANALYTICS_PROJECT_ID=
VERCEL_ANALYTICS_TEAM_ID=
```

Crear un token de Vercel con el acceso mínimo disponible al proyecto/equipo correspondiente; nunca entregárselo al cliente. `TEAM_ID` se omite en proyectos personales. El servidor consulta la [API de Vercel](https://vercel.com/docs/analytics/web-analytics-api), filtrando producción y la ruta pública `/`, con fechas equivalentes a Madrid. La disponibilidad histórica depende del plan de Vercel. El panel muestra visitantes y páginas vistas, no toda la interfaz de Vercel.

Si la conexión falta, falla, el formato no es compatible o el período no está disponible, muestra visitas no disponibles, conservando el informe de solicitudes. No inventa cero visitantes ante un fallo. La conversión solicitudes/visitantes es orientativa; una persona puede enviar varias solicitudes y los bloqueadores pueden impedir medir visitas. Los eventos personalizados no son necesarios para el recuento fiable de solicitudes en este panel.

## Configuración del mensaje de WhatsApp

El panel permite seleccionar una plantilla aprobada e idioma, previsualizarla con un nombre de ejemplo y activar/pausar los envíos. No admite un texto libre para enviarlo directamente. Crear o editar el mensaje en WhatsApp Manager y esperar a que Meta lo apruebe, después sincronizar el catálogo. Solo se admiten plantillas de cuerpo de texto, sin otras secciones, con una única aparición del parámetro posicional `{{1}}` de nombre.

Para sincronizar, un administrador pulsa **Sincronizar con Meta** en `/admin/whatsapp`. El botón llama desde el servidor a la Edge Function `sync-whatsapp-templates` con la sesión del usuario. La función verifica esa sesión con Supabase Auth y comprueba que la cuenta de administrador siga activa antes de consultar Meta.

Configurar estos Secrets en Supabase (nunca en el navegador ni en Next.js):

```dotenv
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WABA_ID=
WHATSAPP_GRAPH_API_VERSION=
```

El token necesita acceso para leer las plantillas de esa cuenta de WhatsApp Business (`whatsapp_business_management`). `WHATSAPP_WABA_ID` identifica la cuenta; no es el identificador del número. Supabase proporciona las credenciales de su propio servidor a la función.

```powershell
pnpm exec supabase functions deploy sync-whatsapp-templates
```

La función consulta todas las páginas del catálogo de Meta y sincroniza de forma transaccional solo las plantillas aprobadas y compatibles: un cuerpo de texto con una única variable posicional `{{1}}` para el nombre, sin cabecera, pie ni botones. Las que ya no aparecen se marcan como no aprobadas. No crea ni presenta plantillas a revisión, y no cambia la selección ni activa envíos. La aprobación mostrada es la del último refresco del catálogo; pulsar de nuevo el botón tras cambios en Meta. Si Meta no responde o una página falla, el catálogo anterior queda intacto. El desplegable y la vista previa se actualizan al terminar. Esta sincronización es manual; no depende de Cron. El comando `scripts/admin.mjs sync-templates` se ha retirado.

La migración crea la configuración **pausada** y sin plantilla. El nombre y el idioma ya no se leen de `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANGUAGE`: es necesario sincronizar y seleccionar una plantilla en `/admin/whatsapp`. Actualizar también la Edge Function para que use `claim_configured_whatsapp_job`.

La configuración se comprueba de forma atómica al reclamar cada trabajo. Se registra quién cambió la selección/pausa y cuándo. Una revisión evita que dos administradores sobrescriban cambios: ante conflicto, hay que recargar. El nombre, idioma y versión Graph de un mensaje se mantienen en sus reintentos. Si su plantilla fue retirada del catálogo, queda pendiente hasta revisión, sin sustituirla silenciosamente.

La pausa impide nuevas reclamaciones de mensajes pendientes, pero un envío ya iniciado puede terminar. El mantenimiento sigue archivando trabajos finalizados y marcando los procesamientos interrumpidos como `delivery_unknown`. Reactivar permite procesar el backlog con consentimiento: revisar esos pendientes antes.

La activación del panel no configura las credenciales, despliega el worker ni habilita Cron. También hacen falta `WHATSAPP_SEND_ENABLED=true`, los Secrets completos del worker y la activación de Cron siguiendo [la guía](activacion.md). Mantener Secrets y Cron apagados durante las pruebas de configuración. “Aceptados por Meta” no acredita entrega ni lectura. `delivery_unknown` requiere revisión manual y no tiene un botón de reenvío automático.

## Validación local y prueba posterior

La navegación precarga las cinco pantallas y conserva su contenido durante 60 segundos en la memoria del navegador mediante `use cache: private`. No se comparte entre sesiones ni se persiste al recargar. Cada petición al servidor comprueba el usuario y su acceso activo; las acciones de guardar siempre vuelven a autorizar el cambio. «Actualizar datos» fuerza una consulta reciente y limpia la caché de navegación. Guardar WhatsApp y cerrar sesión también invalidan el contenido anterior. Los contactos nuevos y los cambios externos de reservas o mensajes pueden tardar hasta un minuto en aparecer al navegar; usar «Actualizar datos» para verlos inmediatamente.

Las pruebas de navegador local crean cuentas temporales con Supabase Auth, prueban login, permisos, revocación, invitación, recuperación, logout, contactos y cambios de configuración con conflicto. También revisan el ancho móvil. Las cuentas y la plantilla de prueba se eliminan y se restaura la configuración original. Las pruebas SQL cubren permisos, auditoría, límites, pausa y reintentos. Vercel y Meta se simulan en las pruebas de sus respuestas; no se conectan cuentas reales.

Tras desplegar: crear una cuenta real, comprobar acceso/revocación y cookies HTTPS, conectar Vercel Analytics y contrastar las visitas del mismo período, sincronizar plantillas aprobadas de Meta y hacer la prueba de WhatsApp con un número propio autorizado antes de activar Cron.
