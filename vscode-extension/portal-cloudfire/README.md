# WPipe Studio — Enterprise Customer Self-Service Portal

Portal web de autoservicio para empresas y clientes de WPipe Studio. Permite a los compradores gestionar sus asientos de licencia concurrentes (*floating seat leases*), visualizar los equipos activos en tiempo real con su último *heartbeat*, y desvincular o liberar puestos con 1 solo clic cuando un ordenador se avería o un empleado deja la empresa.

---

## 🛠️ Tecnologías y Librerías Utilizadas

A continuación se describen las tecnologías y librerías clave que componen este portal:

- **React 18 (`react`, `react-dom`):** Biblioteca declarativa de componentes para interfaces de usuario reactivas y de alto rendimiento.
- **Vite (`vite`, `@vitejs/plugin-react`):** Bundler y entorno de desarrollo frontend ultrarrápido con ESM nativo.
- **Tailwind CSS (`tailwindcss`, `postcss`, `autoprefixer`):** Framework CSS utilitario para estilizado responsivo con modo oscuro (*dark theme*) y diseño enterprise.
- **Lucide React (`lucide-react`):** Conjunto optimizado de iconos vectoriales SVG para dashboards y componentes visuales.
- **TypeScript (`typescript`):** Tipado estático riguroso para interfaces de dispositivos, licencias y respuestas de API.
- **Cloudflare Pages (`wrangler`):** Plataforma serverless de alojamiento web global con coste de **0 €/mes** y tiempo de respuesta inferior a 30 ms.

---

## 🚀 Despliegue en Cloudflare Pages

El portal se despliega como una SPA estática servida a través del subdominio `portal.wisrovi.dev`:

```bash
# 1. Instalar dependencias
npm install

# 2. Compilar aplicación
npm run build

# 3. Desplegar en Cloudflare Pages
npx wrangler pages deploy dist --project-name=wpipe-portal
```

---

## 🔒 Flujo de Autenticación y Seguridad

1. El cliente introduce su `license_key` (recibida tras la compra en Lemon Squeezy o emitida por William).
2. Se realiza una petición a `https://api.wisrovi.dev/v1/portal/login` validando la existencia y estado activo de la licencia en Cloudflare D1.
3. El portal visualiza los asientos contratados, los asientos ocupados por leases activos (con TTL de 2 horas) y la lista de máquinas conectadas.
4. El botón **Liberar Asiento** ejecuta `DELETE https://api.wisrovi.dev/v1/portal/seats/:id`, liberando el puesto en Cloudflare D1 en 100 ms para que un nuevo equipo pueda utilizarlo de inmediato.
