

# Build estático con base path `/business/calculadora/`

Objetivo: generar una carpeta lista para subir a tu servidor (con `index.html` + assets JS/CSS) y que toda la app se sirva bajo la ruta `/business/calculadora/`.

## Cambios a aplicar

### 1. `vite.config.ts` — activar prerender y base path

Reemplazar el contenido actual por:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    base: "/business/calculadora/",
  },
  tanstackStart: {
    prerender: {
      enabled: true,
      crawlLinks: true,
    },
    pages: [{ path: "/" }],
  },
});
```

- `base` hace que todos los assets (JS, CSS, imágenes) se referencien con el prefijo `/business/calculadora/` dentro del HTML generado.
- `prerender` ejecuta tu ruta `/` en build-time y emite un `index.html` ya con el contenido de la calculadora pre-renderizado, en vez de un bundle de Worker.

### 2. (Opcional) `src/router.tsx` — informar el basepath al router

Si al recargar en el servidor el routing client-side se rompe, añadir `basepath` al `createRouter`:

```ts
const router = createRouter({
  routeTree,
  basepath: "/business/calculadora",
  context: {},
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: DefaultErrorComponent,
});
```

(Se aplica solo si detectamos rupturas tras el primer build; con una única ruta `/` puede no ser necesario.)

## Cómo lo usarás después

1. Ejecutar el build:
   ```bash
   bun run build
   ```
2. Abrir la carpeta `dist/client/` — ahí estará:
   - `index.html` (ya con la calculadora renderizada y referencias a `/business/calculadora/assets/...`)
   - `assets/` (JS y CSS con hash)
   - Cualquier favicon/estático
3. Subir **todo el contenido de `dist/client/`** a la ruta `https://tu-servidor/business/calculadora/` de tu servidor.
4. Configurar el fallback SPA en el servidor para esa ruta:
   - **nginx:**
     ```nginx
     location /business/calculadora/ {
       try_files $uri $uri/ /business/calculadora/index.html;
     }
     ```
   - **Apache (`.htaccess` dentro de la carpeta):**
     ```
     RewriteEngine On
     RewriteBase /business/calculadora/
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /business/calculadora/index.html [L]
     ```

## Notas importantes

- La carpeta `dist/server/` que también genera el build **se descarta**: no la necesitas para servir estáticamente.
- `wrangler.jsonc` queda intacto pero deja de ser relevante para este flujo.
- No se añaden dependencias nuevas; el prerender ya viene en TanStack Start.
- No hace falta tocar `DiscountCalculator.tsx` ni `calc.ts`; toda la lógica es client-side y compatible con prerender.
- Si más adelante quieres cambiar el path base (por ejemplo a `/calc/`), basta con editar `base` en `vite.config.ts` (y `basepath` en el router si se añadió) y rebuildear.

## Verificación local antes de subir

```bash
bun run build
npx serve dist/client -s
```
Abrir `http://localhost:3000/business/calculadora/` y confirmar que la calculadora carga y funciona. Ver fuente de página: el HTML debe contener ya la tabla de la calculadora (no solo un div vacío).

