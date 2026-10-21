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

# 3. Desplegar a Producción (portal.wisrovi.dev)
npm run deploy
# o directamente:
# npx wrangler pages deploy dist --project-name=wpipe-portal --branch=main --commit-dirty=true
```

---

## 🔒 Flujo de Autenticación Blindada (OTP + Admin Key)

1. **Acceso por Correo Corporativo con Código OTP de 6 dígitos**:
   - El director o comprador introduce su email corporativo registrado en Lemon Squeezy o Stripe.
   - El servidor genera un código criptográfico de 6 dígitos (válido por 10 minutos, con limitador de tasa de 5 solicitudes cada 15 min).
   - Se envía a la bandeja del comprador y, al verificarlo, se genera un token de sesión firmado (JWT HS256) con validez de 24 horas.
   - **Blindaje total**: Ningún atacante que conozca el email puede entrar sin acceso al buzón de correo.
2. **Separación de Claves (Terminal VS Code vs. Clave de Administración)**:
   - **Clave de Puesto (`license_key`, ej. `WPIPE-PRO-...`):** Exclusiva para que los desarrolladores activen su extensión en VS Code. El portal rechaza automáticamente cualquier intento de login con claves de puesto (`403 TERMINAL_KEY_NOT_ALLOWED`), impidiendo que empleados o practicantes expulsen a compañeros o accedan a datos corporativos.
   - **Clave de Administración (`admin_key`, ej. `WPIPE-ADM-...`):** Clave maestra privada que solo se envía al comprador o director IT. Permite autenticación directa al portal sin esperar al código por correo.
3. **Detección Automática de Organización & Selector Departamental**:
   - Tras autenticarse, Cloudflare D1 localiza todas las licencias de la empresa y ofrece un selector reactivo en la barra superior para alternar departamentos en caliente.
4. **Tacómetro de Puestos y Auditoría de Equipos**:
   - Visualiza en vivo los puestos contratados, activos y libres, junto a la tabla de máquinas conectadas con su último *heartbeat*.
5. **Liberación Instantánea de Asientos**:
   - El botón **Liberar Asiento** ejecuta `DELETE /v1/portal/seats/:id`, liberando el puesto en D1 en menos de 50 ms para que un nuevo ordenador tome el relevo de inmediato.
