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

1. **Dashboard de Métricas en Vivo & NOC Telemetry**:
   - Total de licencias registradas y activas.
   - Puestos flotantes (leases) conectados en tiempo real.
   - Eventos de seguridad y webhooks en los últimos 7 días.
   - Barra segmentada de distribución visual de licencias por nivel (`Starter`, `Pro`, `Enterprise`, `VIP/Partner`).
   - Panel guardián de vencimientos próximos (&lt;30 días) con botón de renovación rápida en 1 clic.
   - NOC Auto-Refresh configurable (`OFF`, `10s`, `30s`, `60s`) con telemetría de latencia al edge de Cloudflare (ms) y PoP activo.

2. **Gestión Global y Masiva de Licencias**:
   - Barra de acciones por lote: selección múltiple para activar, suspender o incrementar asientos a decenas de licencias simultáneamente.
   - Búsqueda en tiempo real por correo, clave de licencia o cliente.
   - Filtro por estado (`active`, `suspended`, `expired`) y por plan (`starter`, `pro`, `enterprise`, `vip`).
   - Cajón desplegable en acordeón para inspeccionar las máquinas conectadas en vivo a cada licencia.
   - Modal de edición completa con botones de extensión rápida (`+30 Días`, `+90 Días`, `+1 Año`, `Vitalicia`).
   - Modificación instantánea de asientos (`max_seats` con botones `+` y `-`).
   - Activación y suspensión de licencias en 1 clic.
   - Exportación de toda la base de licencias a formato CSV.

3. **Minter VIP & Partners Pro**:
   - Emisión soberana de licencias comerciales y partners sin pasar por pasarela de pago.
   - Enlace directo de activación de 1 clic para VS Code (`vscode://wisrovi.wpipe-studio-vscode/activate?key=...`).
   - Generador visual de código QR de activación rápida para tabletas o puestos físicos.
   - Generador automático de plantilla de correo de bienvenida en Markdown para el socio con comandos de activación para terminal.

4. **Monitor de Leases Flotantes & Inspección de Hardware**:
   - Inspección de estaciones de trabajo activas (hostname, OS, huella de máquina SHA-256).
   - Botón de búsqueda por huella de hardware para ver todas las sesiones asociadas a un ordenador físico.
   - Botón de expulsión inmediata (1-click kick) para liberar puestos ocupados.
   - Botón para purgar todos los leases expirados automáticamente.
   - Búsqueda en vivo de puestos por máquina, SO o usuario.

5. **Consola SQL Interactiva para D1 con Explorador Dinámico de Esquemas**:
   - Explorador de tablas en tiempo real con árbol interactivo (`licenses`, `leases`, `audit_logs`, `otp_codes`, `activations`).
   - Inserción en 1 clic de nombres de columnas y tablas directamente en el editor SQL.
   - Historial de las últimas 8 consultas ejecutadas persistido en navegador.
   - Tabla de resultados ordenable por columnas (ASC / DESC).
   - Medición precisa de tiempo de ejecución en milisegundos (`duration ms`) y región de Cloudflare.
   - Exportación de resultados de cualquier consulta a **CSV** y **JSON**.

6. **Flujo de Auditoría**:
   - Registro de los últimos 100 eventos de licencias y webhooks de Lemon Squeezy con exportación a CSV.

7. **Sistema de Notificaciones Flotantes Toast**:
   - Notificaciones contextuales animadas para confirmaciones de operaciones, copiado de claves y alertas del sistema.

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
