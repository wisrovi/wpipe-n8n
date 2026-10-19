# WPipe Studio — Cloudflare Admin Web Dashboard

Panel de administración web para la gestión integral de licencias, activación de máquinas de hardware, distribución de binarios en Cloudflare R2 y auditoría de seguridad del ecosistema **WPipe Studio (wisrovi SUITE)**.

---

## 🛠️ Tecnologías y Librerías Utilizadas

A continuación se describen las tecnologías y librerías clave utilizadas en este componente:

- **Python 3.11+**: Lenguaje base para la lógica de administración, cliente de base de datos D1 y servidor de interfaz.
- **Streamlit**: Framework interactivo para la construcción ágil de paneles de control, tablas dinámicas con filtros, métricas (KPIs) y formularios reactivos.
- **Pandas**: Estructuración y manipulación de datos en memoria para la presentación tabular de licencias, activaciones y logs de auditoría.
- **Cloudflare D1 & REST API**: Base de datos SQLite serverless distribuida en el Edge de Cloudflare, consultada en milisegundos mediante la API REST de Cloudflare.
- **Cloudflare R2**: Almacenamiento de objetos S3-compatible con cero tarifas de egreso (Zero-Egress Fees) para la distribución de los binarios ejecutables de `wpipe-engine`.
- **Docker & Docker Compose**: Empaquetado en contenedor ligero con healthcheck y orquestación multi-entorno.
- **Pytest & Pytest-Cov**: Framework de pruebas unitarias automatizadas y cálculo de cobertura de código.

---

## 🚀 Despliegue con Docker Compose

### 1. Configuración de Variables de Entorno

Copia el archivo `.env.example` a `.env` y configura tus credenciales de Cloudflare y la contraseña de acceso:

```bash
cp .env.example .env
```

Variables disponibles:
- `CLOUDFLARE_ACCOUNT_ID`: ID de tu cuenta de Cloudflare (ej. `e3a420c4...`).
- `CLOUDFLARE_D1_DATABASE_ID`: ID de la base de datos D1 `wpipe_licenses` (`44bf0372-587d-446d-84c3-1153c4183b99`).
- `CLOUDFLARE_API_TOKEN`: Token de API con permisos `D1:Edit`.
- `ADMIN_PASSWORD`: Contraseña para la pantalla de inicio de sesión (por defecto: `wisrovi2026`).
- `API_BASE_URL`: URL base del Cloudflare Worker (`https://api.wisrovi.dev`).

### 2. Iniciar el Servicio

Para construir y levantar el contenedor en segundo plano:

```bash
docker compose up -d --build
```

El panel estará disponible en tu navegador en:  
👉 **`http://localhost:8501`**

### 3. Detener el Servicio

```bash
docker compose down
```

---

## 💻 Ejecución Local sin Docker (Modo Desarrollo)

Si deseas ejecutar la aplicación directamente en tu entorno local de Python:

```bash
pip install -r requirements.txt
streamlit run app.py
```

---

## 🧪 Pruebas Unitarias y Cobertura

El proyecto incluye una suite de pruebas unitarias con `pytest` que valida la generación criptográfica de claves, las consultas SQL parametrizadas a D1, la desvinculación de hardware y los cálculos de estadísticas.

### Ejecutar pruebas con Docker (Recomendado):

Ejecuta el script automatizado que descarga la imagen base, instala dependencias y genera el reporte de cobertura:

```bash
./tests/run_tests.sh
```

### Ejecutar pruebas manualmente con Pytest:

```bash
pytest tests/ -v --cov=client --cov-report=term-missing --cov-report=html:tests/coverage_html
```

---

## 📑 Estructura de Pestañas del Panel

1. **👥 Licencias & Clientes**:
   - Generación de claves de licencia Pro, Team y Enterprise con formato `WPIPE-PRO-XXXX-XXXX-XXXX`.
   - Búsqueda en tiempo real por correo electrónico, nombre o clave.
   - Activación, suspensión o revocación inmediata de licencias.

2. **💻 Máquinas & Leases**:
   - Visualización de huellas digitales de hardware (`machine_fingerprint` SHA-256), hostnames y sistemas operativos vinculados.
   - Botón de desvinculación rápida para liberar cupos cuando un desarrollador formatea o cambia de ordenador.

3. **📦 Binarios & R2**:
   - Consulta del manifiesto de versiones activo servido por Cloudflare Edge.
   - Instrucciones y comandos para publicar nuevas versiones de `wpipe-engine`.

4. **📜 Logs de Auditoría**:
   - Registro cronológico detallado de todos los intentos de activación, direcciones IP y eventos de renovación.
