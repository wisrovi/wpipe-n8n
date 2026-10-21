# WPipe Studio - Super-Admin Web Console

A secure, serverless super-administrative web application designed for William Rodriguez to manage the complete lifecycle of WPipe Studio floating licenses, enterprise seats, active worker leases, and Cloudflare D1 database operations with zero operational cost.

- **Production URL**: [https://wpipe-admin.pages.dev](https://wpipe-admin.pages.dev) (Custom domain: `https://admin.wisrovi.dev`)
- **Backend API**: Cloudflare Worker at `https://api.wisrovi.dev`
- **Hosting**: Cloudflare Pages (Free Tier: 0 €/month, globally distributed edge CDN)

---

## 🛠️ Tecnologías y Librerías Relevantes

Este componente utiliza el siguiente stack tecnológico optimizado para velocidad, seguridad estricta y bajo consumo de recursos:

| Tecnología / Librería | Versión / Tipo | Propósito en el Ecosistema |
| :--- | :--- | :--- |
| **React** | `^18.3.1` | Librería reactiva para la interfaz de administración y gestión de estado. |
| **Vite** | `^5.4.21` | Bundler y servidor de desarrollo ultra-rápido basado en ESM. |
| **TypeScript** | `^5.6.3` | Tipado estricto para modelos de licencias, leases y respuestas de la API. |
| **Tailwind CSS** | `^3.4.14` | Framework CSS utilitario para diseño moderno con modo oscuro de alta fidelidad. |
| **Lucide React** | `^0.453.0` | Conjunto de iconos vectoriales para acciones de base de datos, seguridad y métricas. |
| **Cloudflare Pages** | Serverless Edge | Despliegue estático global con SSL automático y protección contra DDoS. |
| **Cloudflare D1** | SQLite Distribuido | Base de datos relacional serverless donde residen las licencias y auditorías. |
| **Cloudflare Workers** | Edge Compute | Microservicio REST autenticado con Master Key para operaciones CRUD y ejecución SQL. |

---

## 🚀 Características Principales

1. **Dashboard de Métricas en Vivo**:
   - Total de licencias registradas y activas.
   - Puestos flotantes (leases) conectados en tiempo real.
   - Eventos de seguridad y webhooks en los últimos 7 días.
   - Monitor de estado de infraestructura Cloudflare D1 y Workers.

2. **Gestión Global de Licencias**:
   - Búsqueda en tiempo real por correo, clave de licencia o cliente.
   - Filtro por estado (`active`, `suspended`, `expired`).
   - Modificación instantánea de asientos (`max_seats` con botones `+` y `-`).
   - Activación y suspensión de licencias en 1 clic.
   - Copia rápida al portapapeles de claves de puesto y claves de administración.

3. **Minter VIP / Enterprise**:
   - Generación instantánea de licencias comerciales y partners sin pasar por pasarela de pago.
   - Asignación configurable de asientos flotantes y clave administrativa personalizada.

4. **Monitor de Leases Flotantes**:
   - Inspección de estaciones de trabajo activas (hostname, OS, huella de máquina SHA-256).
   - Botón de expulsión inmediata (1-click kick) para liberar puestos ocupados.
   - Botón para purgar todos los leases expirados automáticamente.

5. **Consola SQL Interactiva para D1**:
   - Editor de consultas SQL con benchmarks de tiempo de ejecución en milisegundos.
   - Presets integrados para auditoría rápida (`Licencias`, `Leases Activos`, `Códigos OTP`, `Log de Auditoría`).
   - Visualizador tabular de resultados con recuento de filas afectadas.

6. **Flujo de Auditoría**:
   - Registro de los últimos 100 eventos de licencias y webhooks de Lemon Squeezy.

---

## 💻 Desarrollo Local y Despliegue

### Requisitos Previos
- Node.js 18+
- npm

### Instalación y Ejecución Local
```bash
cd wpipe-studio/vscode-extension/admin-web
npm run dev
```

### Compilación para Producción
```bash
npm run build
```

### Despliegue a Cloudflare Pages
```bash
npx wrangler pages deploy dist --project-name=wpipe-admin --branch=main --commit-dirty=true
```
