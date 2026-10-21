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

## 🔒 Flujo de Autenticación y Gestión Multi-Licencia

1. **Acceso Flexible**: El cliente puede identificarse ingresando cualquiera de sus claves de licencia (`license_key`) o directamente su correo corporativo (`customer_email`) registrado en la compra.
2. **Detección Automática de Organización**: El servidor consulta todas las licencias activas pertenecientes al mismo comprador en Cloudflare D1.
3. **Selector Departamental**: Si la empresa cuenta con 2 o más licencias (ej. Departamento de IA y Departamento Backend), se despliega un selector en la barra superior para alternar entre ellas en caliente sin tener que re-autenticarse.
4. **Tacómetro de Puestos y Auditoría**: El portal visualiza los asientos contratados, los puestos ocupados por leases flotantes (TTL de 2 horas) y la lista de máquinas conectadas.
5. **Liberación Instantánea**: El botón **Liberar Asiento** ejecuta `DELETE https://api.wisrovi.dev/v1/portal/seats/:id`, liberando el puesto en Cloudflare D1 en 100 ms para que un nuevo equipo pueda utilizarlo de inmediato.
