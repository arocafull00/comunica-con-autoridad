# Comunica con Autoridad

Web pública de la masterclass de Ignacio Roa. El formulario completo se guarda en Google Sheets y, tras confirmar el guardado, abre la reserva de Cal.com.

## Desarrollo

```sh
pnpm install
pnpm dev
```

La web utiliza el Apps Script existente. `GOOGLE_SHEETS_ENDPOINT` permite usar otro endpoint, por ejemplo, para probar con una hoja de pruebas. La portada y el formulario funcionan sin credenciales de Supabase.

```sh
pnpm lint
pnpm test
pnpm build
pnpm test:browser
```

Las pruebas de navegador usan un servidor local que simula Google Sheets. El detalle del flujo está en [Formulario de la masterclass](docs/formulario-masterclass.md).

Las migraciones y Edge Functions en `supabase/` corresponden al sistema anterior y quedan como referencia. La web actual sirve la portada y el endpoint de guardado. Los cron ya configurados dentro de un proyecto Supabase se gestionan desde ese proyecto.
