# wpipe-studio

**SaaS multi-tenant estilo n8n para diseñar pipelines WPipe y generar microservicios Python verificados, listos para producción.**

> **Agentes de IA:** lee [`AGENTS.md`](./AGENTS.md) **completo antes de tocar nada.**
> Contiene las decisiones cerradas (`[DECIDIDO]`), el diseño del IR, los controles de
> seguridad del sandbox, y los bugs reales que hay que evitar replicar.

---

## Qué hace

1. **Planea** — de una descripción en lenguaje natural a un plan de trabajo.
2. **Genera** — el microservicio completo: FastAPI + pipeline WPipe + Docker + Makefile + tests.
3. **Verifica** — ejecuta la batería de calidad en un sandbox Docker y itera con el agente
   hasta que todo pasa.
4. **Entrega** — un ZIP que funciona de verdad, no código plausible.

**El criterio de éxito es uno solo:** `app/pipelines.py` corre de punta a punta y pasa la
batería (black · isort · ruff · mypy · pylint · pytest cov ≥ 60% · `dry_run_pipeline`).
Si algo falla, no hay ZIP.

---

## Tecnologías y Librerías Principales

- **PostgreSQL 15 & `wpostgresql`**: Persistencia relacional empresarial utilizando la librería `wpostgresql` (patrón Data Access Layer con modelos Pydantic `User`, `Project`, `AuthToken`, repositorios tipados `UserRepository`, `ProjectRepository`, `TokenRepository`, sincronización automática de esquema con `TableSync` migrations y pool de conexiones `psycopg_pool`). El servicio de base de datos se despliega en Docker Compose en `wpipe-studio/enviroment` (`wpipe_postgres` y `wpipe_pgadmin4` en puerto 1717), manteniendo un fallback transparente a SQLite para desarrollo sin Docker o suites de tests aisladas.
- **FastAPI**: Framework web asíncrono de alto rendimiento para la API backend (`/api/v1`).
- **Docker Compose & Makefile Unificado**: Orquestación unificada y declarativa para levantar backend (`wpipe-studio-backend`), frontend (`wpipe-studio-frontend`), PostgreSQL (`wpipe_postgres`) y PGAdmin4 (`wpipe_pgadmin4`) mediante comandos estándar (`make start`, `make stop`, `make restart`, `make test`, `make logs`).
- **Nginx (Alpine)**: Servidor web de producción ligero y de alto rendimiento que sirve los assets estáticos del frontend SPA y actúa como reverse proxy hacia el backend FastAPI (`/api/`) y volumen estático (`/media/`).
- **Volumen Persistente de Host (`./media`)**: Mapeo compartido (`./media:/app/media` en backend y `./media:/usr/share/nginx/html/media:ro` en frontend) que garantiza que todos los workspaces físicos aislados (`media/workspaces/{owner_id}/{microservice_name}/`) persistan en el host del usuario con su código fuente ejecutable completo sin pérdida de datos.
- **Autenticación Criptográfica & Control de Sesiones**: Hash seguro de contraseñas con PBKDF2-HMAC-SHA256 (100.000 iteraciones + salt aleatorio) y sesiones autenticadas por Bearer Tokens para aislamiento estricto multi-tenant.
- **Pydantic v2**: Validación de datos estricta y esquemas del IR (`CanvasIR`, `SemanticIR`, `TargetIR`, `UserProfile`, `ProjectDetail`, `AuthTokenResponse`).
- **React 18 & TypeScript**: Interfaz visual de usuario para el Canvas de diseño de pipelines, visor de código y etapa de simulación.
- **Blockly (`blockly`)**: Motor de programación visual basado en bloques ensamblables, adaptado a la distribución visual de Scratux 3.0 con serialización completa de workspace.
- **Lucide React (`lucide-react`)**: Iconografía para la barra superior, categorías, proyectos, avatares y controles de ejecución.
- **Mermaid & D3**: Visualización interactiva de grafos dirigidos (DAG) con navegación fluida, pan & zoom, y exportación SVG.
- **PrismJS (`prismjs`)**: Motor de resaltado de sintaxis en tiempo real para Python, YAML, Dockerfile, Makefile, Bash y JSON con tema Tomorrow Night y editor superpuesto (live overlay).
- **Zod**: Validación de esquemas del IR en el frontend espejo de Pydantic.
- **Vite & Tailwind CSS**: Bundler ultrarrápido, utilidades CSS y componentes con tema oscuro profesional estilo Scratch 3.0 / Scratux.
- **Pytest & Pytest-Cov**: Suite de pruebas automatizadas con validación de cobertura de código (>80%).
- **Docker Sandbox**: Entorno aislado y efímero para la ejecución de pruebas y verificación de calidad.

---

## Interfaz Visual, Bloques Dinámicos, Modo Simulación y Navegación GitHub

La interfaz de `wpipe-studio` ofrece una experiencia visual estilizada inspirada en Scratch 3.0 / Scratux y GitHub.com, optimizada para máxima productividad con bloques configurables:

1. **Barra Superior (Top Menu Bar)**: Selector de 4 pestañas modulares (🧩 Canvas de Diseño, 🎮 Simulación & Depuración, 📊 Flujo Mermaid DAG y 💻 Microservicio Python), selector y gestor de microservicios con botón Guardar directo, menús desplegables enriquecidos de Archivo y Edición (Colapsar/Expandir todos los bloques, Deshacer/Rehacer, Zoom to Fit, Modo Turbo, Guardar/Restaurar en localStorage, Exportar Canvas JSON y Descargar ZIP) y píldora de perfil de usuario multi-tenant con cambio rápido de sesión.
2. **Tira Lateral de Categorías Scratch 3.0 (Far Left Dot Column)**:
   - Selectores circulares temáticos por categoría: Inicio (Ámbar), Pasos (Azul), Control (Naranja), Bucles (Amarillo) y Paralelo (Esmeralda).
   - Botón de proyectos `[ 📁 PROY ]` en la parte inferior (reemplazando el antiguo botón `EXT`) para abrir el gestor modal de microservicios aislados del usuario activo.
3. **Paleta Visual de Bloques Puzzle (Scratch 3.0 / Scratux Toolbox)**:
   - Diseño visual de auténticas piezas de puzzle Scratch con pestañas de ensamble, muescas de encaje y paleta de colores vibrantes sin cajas de texto invasivas.
   - Buscador rápido en tiempo real para filtrar bloques al instante.
   - **Tarjeta descriptiva flotante (Hover Tooltip)**: al posar el cursor sobre cualquier bloque, se despliega una tarjeta enriquecida con la descripción del bloque, los parámetros configurables y el código Python WPipe equivalente generado.
   - 🚀 **Lanzador de Pipeline (Trigger Hat Block)**: Bloque sombrero de inicio que configura el punto de entrada al pipeline (FastAPI REST `POST /run`, Kafka Consumer, Redis Queue, Cron / Programador, Webhook, CLI local), reflejado automáticamente en diagramas Mermaid y en wrappers de ejecución en `app/main.py`.
   - 🏁 **Cierre de Pipeline (Response Cap Block)**: Bloque terminal Cap (muesca superior y base plana Scratch) que define la salida o respuesta final del microservicio (Respuesta HTTP 200 JSON, publicación de eventos en tópicos Kafka, colas Redis, guardado de contexto en archivo JSON o retorno directo). Sincronizado en tiempo real con Mermaid (`classDef endResponse`), esquemas IR y generación de rutas en `app/main.py`.
   - 📦 **Paso de Catálogo (Universal)**: Bloque interactivo con selectores internos directos: filtrado por origen (`Oficiales` / `Plugins` con auto-actualización inmediata del paso seleccionado), selector dinámico de categoría, filtro de búsqueda por texto y lista desplegable con los 197 steps del catálogo (incluyendo plugins comunitarios como `ecam_yolo` y `rss_parser`).
   - ✨ **Paso con IA (Dialecto A)**: Bloque para arrastrar y describir en lenguaje natural el comportamiento deseado. Genera la función decorada con `@step` y su Context DTO Pydantic (`app/dto/` y `app/states/`).
   - 📄 **Paso Personalizado (.py)**: Bloque con acción de adjunto de archivos Python locales (`.py`), empaquetándolos directamente en el microservicio.
   - 🔀 **Condición Si (Single Branch)**: Bloque de bifurcación condicional simple sin rama else (`Condition(expression=..., branch_true=[...])`).
   - ⚖️ **Condición Si / Sino (Dual Branch)**: Bloque condicional completo con ramas `VERDADERA` y `FALSA`.
   - 🔁 **Bucle Mientras (While Loop)**: Bloque de repetición condicional continua (`For(validation_expression=..., steps=[...])`).
   - 🔢 **Bucle Repetir (For Loop)**: Bloque de repetición determinista N veces (`For(iterations=N, steps=[...])`).
   - ⚡ **Ejecución Paralela (Parallel)**: Bloque de concurrencia con política de fusión de contexto (`accumulate` o `last_wins`).
   - ⏳ **Segundo Plano (Background)**: Bloque de ejecución asíncrona no bloqueante en hilo secundario (`Background(step=...)`).
4. **Área Central de Bloques (Blockly Canvas)**:
   - Espacio de trabajo infinito con permanencia en DOM (no se destruye al alternar pestañas).
   - **Arrastre panorámico libre del lienzo (`move.drag` & `scrollbars`)**: el usuario puede hacer clic en cualquier área vacía del fondo y arrastrar para encuadrar y explorar el pipeline cómodamente, sin depender únicamente de mover bloques individuales.
   - **Colapsado individual directo en cada bloque (`[-]` / `[+]`)**: cada bloque del lienzo dispone de un botón visible e interactivo en su cabecera para colapsarse sobre sí mismo en una fila compacta informativa, además de soportar doble-clic en el bloque para alternar su estado.
   - **Inserción y auto-conexión inteligente**: al hacer clic sobre cualquier bloque en la paleta lateral, el bloque se posiciona de forma visible en el área de trabajo o se conecta automáticamente al final de la cadena de ejecución o al bloque seleccionado.
   - **Barra de herramientas flotante**: botones rápidos para Centrar lienzo (`scrollCenter()`), Ajustar vista (`zoomToFit()`), Colapsar todo, Expandir todo, Deshacer, Limpiar y Guía FAQ, junto a un indicador interactivo de arrastre.
5. **Pestaña Dedicada de Simulación & Depuración (Simulation Stage)**:
   - Laboratorio de pruebas a pantalla completa (100% del ancho para máxima legibilidad).
   - Controles de ejecución: **Bandera Verde** (🏁 Run), **Octágono Rojo** (🛑 Stop) y Reinicio.
   - Presets de payload listos para usar (API REST, Kafka Event, Redis Queue, Cron Job).
   - Simulador de Payload JSON de entrada editable.
   - Inspector de Contexto en vivo: tabla reactiva de mutación de variables (`data`) en tiempo real.
   - Línea temporal de pasos con tiempos de cómputo en ms y estados (`idle`, `running`, `success`, `error`).
   - Monitor de consumo de recursos en tiempo real (CPU % y memoria RAM en MB).
   - Consola terminal de logs enriquecida (`stdout` / `stderr`).
6. **Flujo Mermaid DAG Interactivo con Pan & Zoom**:
   - Visualización reactiva en tiempo real del pipeline en formato de grafo dirigido.
   - **Arrastre libre (pan)** con ratón desde cualquier punto del área de trabajo para desplazar y explorar diagramas de cualquier dimensión.
   - **Zoom fluido** centrado en el puntero del ratón mediante la rueda y controles flotantes (`+`, `-`, `Reset 100%`, `Centrar`).
   - Brillo hover en nodos y aristas y botón de exportación directa en formato `.svg`.
7. **Entorno de Programación Estilo VS Code (Microservicio Python)**:
   - **Activity Bar Lateral (`w-12`, `#181818`)**: Barra de actividad vertical con iconos para Explorador de Archivos, Búsqueda en Archivos, Control de Código Fuente (Git) con badge reactivo de archivos modificados, accesos directos al Lienzo Blockly y Simulador, y Avatar/Menú de Usuario.
   - **Panel Primario Explorador (`w-64`, `#252526`)**:
     - Filtro instantáneo de archivos por nombre.
     - Árbol jerárquico (`FileTreeItem`) con indentación auténtica, iconos por extensión (🐍 Python, 🐳 Docker, 📝 Markdown, ⚙️ Config/TOML/JSON, 💻 Shell script).
     - Selección de carpetas y archivos independiente: al hacer clic en una carpeta, se abre la vista de carpeta en el editor; al hacer clic en un archivo, se abre en una pestaña.
   - **Barra de Pestañas Multi-Archivo (`#252526`, `#1e1e1e`)**:
     - Pestañas con borde superior azul `#007acc`, indicador de modificación (`●`), botón de cierre (`✕`) y soporte de múltiples archivos abiertos simultáneamente (`openTabs`).
     - Botón de alternancia entre Código y Vista Previa para archivos `README.md`.
     - Acciones contextuales: Editar código, Guardar cambios, Copiar al portapapeles, Descargar archivo.
   - **Barra de Migas de Pan (Breadcrumbs)**:
     - Jerarquía navegable `{proyecto} › {carpeta} › {archivo}` con iconos y enlaces clicables.
   - **Renderizado Dinámico de `README.md` en Carpeta vs Editor Natural**:
     - **Al cargar o seleccionar una carpeta**: Si la carpeta contiene un `README.md`, se renderiza inmediatamente de forma enriquecida y estética mediante el motor Markdown (`marked`), con estilos GitHub, cajas de alertas `[!IMPORTANT]`, `[!NOTE]`, `[!WARNING]`, `[!TIP]`, tablas formateadas, bloques de código y banner con botón directo `[ 📝 Ver Archivo en Editor ]`. Si no tiene README, muestra la tabla de archivos de la carpeta.
     - **Al hacer clic directamente en `README.md`**: Se abre en el editor de código tradicional ("de forma natural"), con canal de números de línea, resaltado de sintaxis, banner protegido de autoría de **wisrovi** ([wisrovi.dev](https://wisrovi.dev)) y botón para alternar a vista previa renderizada.
     - **Editor de Código en Vivo**: Soporta sangría con Tab (4 espacios), seguimiento de posición de cursor (`Ln X, Col Y`), sincronización de scroll y coloreado de sintaxis en tiempo real para Python, Dockerfile, YAML, Makefile, Bash y JSON.
   - **Barra de Estado VS Code (`h-6`, `#007acc`)**:
     - Indicador de entorno remoto `[><] WPipe Studio`.
     - Rama Git activa (`main` con asterisco si hay cambios sin guardar).
     - Contador de diagnósticos (`0 ⚠️ 0 ❌`).
     - Posición del cursor en tiempo real (`Ln X, Col Y`), sangría `Spaces: 4`, codificación `UTF-8`, terminación de línea `LF` y lenguaje activo (`Python`, `Markdown`, `Dockerfile`, etc.).
8. **Inicio de Sesión Natural, Sesiones Seguras y Gestor Multi-Tenant de Microservicios**:
   - **Inicio de Sesión Natural y Cierre de Sesión**: Flujo completo de autenticación con usuario y contraseña, hashing criptográfico PBKDF2-HMAC-SHA256, tokens Bearer de sesión y endpoint `/api/v1/auth/logout`.
   - **Pantalla de Autenticación Centrada y Aislada**: Capa de login/registro a pantalla completa con fondo opaco oscuro (`#07090e`) y alta prioridad (`z-[9999]`) que centra el formulario al píxel e impide que se filtren elementos del lienzo o la interfaz antes de autenticarse.
   - **Vista Inmediata de Proyectos al Iniciar Sesión**: Al autenticarse, se despliega automáticamente el panel de microservicios ("Mis Microservicios") permitiendo cambiar inmediatamente entre proyectos o crear nuevos.
   - **Aislamiento Físico en Volumen Media (`./media`)**: Todo el backend y frontend se ejecutan compartiendo el volumen host `./media`. Cada usuario almacena sus microservicios en `media/workspaces/{owner_id}/{project_id}/`, garantizando aislamiento absoluto entre usuarios y persistencia total entre reinicios de contenedores.
   - **Persistencia Multi-Microservicio**: Creación, guardado en caliente, duplicación/clonación y eliminación de microservicios con un solo clic.
9. **Lienzo Inicial Hello World con los 11 Bloques**:
   - Al cargar o recargar el lienzo, se precarga automáticamente un flujo simple "Hello World" que demuestra la integración de los 11 bloques (Trigger Ingress, Step HttpRequest, AI Step, User File Step, IF, Parallel con MySQLQuery, IF-ELSE con For, Background con RedisGet, While con NmapScanStep y Cierre de Pipeline Response Cap Egress).

---

## Tecnologías y Librerías Relevantes

El ecosistema de **WPipe Studio** integra tecnologías modernas orientadas a rendimiento, aislamiento y experiencia de desarrollo profesional:

| Capa | Tecnologías y Librerías Clave |
|------|--------------------------------|
| **Frontend** | **React 18** (SPA reactiva), **TypeScript** (tipado estricto), **Vite** (bundler de alto rendimiento), **Tailwind CSS** (sistema de diseño atómico), **Google Blockly** (motor de lienzo de bloques Scratch), **Mermaid JS** (renderizado de DAG con pan & zoom), **PrismJS** (coloreado sintáctico en vivo), **Marked** (motor de renderizado GFM de READMEs y alertas), **Lucide React** (iconografía VS Code). |
| **Backend** | **FastAPI** (framework API asíncrono Python 3.11), **Uvicorn** (servidor ASGI ASGI), **Pydantic v2 & Pydantic-Settings** (validación de esquemas y configuración), **WPostgreSQL** (capa DAL oficial del ecosistema), **WSQLite** (persistencia y transacciones ligeras), **Psycopg 3 & Psycopg-Pool** (driver PostgreSQL nativo con pool thread-safe), **Pytest** (suite de pruebas unitarias y regresión). |
| **Infraestructura & Contenedores** | **Docker** & **Docker Compose** (orquestación multi-contenedor), **PostgreSQL 15** (base de datos relacional), **PgAdmin 4** (consola web de administración de datos), **Nginx Alpine** (servidor web y reverse-proxy de producción), **Volúmenes Persistentes Host** (`./media` para microservicios y `./enviroment/db` para PostgreSQL). |

---

## Despliegue con Docker Compose (Recomendado)

Tanto el backend FastAPI como el frontend SPA Nginx, junto a PostgreSQL y PgAdmin, se encuentran completamente orquestados en `docker-compose.yml`, compartiendo el volumen `./media` del host:

```bash
# Construir y levantar todos los contenedores en segundo plano
docker-compose up -d --build

# Verificar estado y salud de los contenedores
docker-compose ps

# Ver logs en tiempo real
docker-compose logs -f

# Detener los servicios
docker-compose down
```

Una vez levantado:
- **Frontend SPA**: `http://localhost:5173`
- **Backend API & Swagger**: `http://localhost:8000/docs`
- **PgAdmin 4 Web Console**: `http://localhost:1717` (wisrovi@wisrovi.dev / admin)
- **PostgreSQL 15**: `localhost:5432` (`wpostgresql`)
- **Volumen Persistente de Host**: `./media/`

---

## Cómo ejecutar los tests

### 1. Ejecución local con pytest
```bash
cd backend
python3 -m pytest -q
```

### 2. Cálculo de cobertura de código
```bash
./run_coverage.sh
```

### 3. Ejecución dentro del contenedor Docker
```bash
./run_tests_docker.sh
```

---

## Estado

| | |
|---|---|
| **Fase** | Sprint 0 completado — Cimientos, IR Pydantic/Zod, Catalog Service, Scratux 3.0 Canvas UI, Codegen de bloques de control (`Condition`, `For`, `Parallel`), DTOs Dialecto A y Modo Simulación. |
| **Ecosistema** | Vive en `wpipe_os/` junto a `wpipe` 2.5.10, `wpipe-steps` (**196 steps**), `wpipe-plugins`, `wpipe-mcp` 0.4.1 (11 tools MCP), `wpipe-api`. |
| **Catálogo** | `steps_catalog.json` es el **manifiesto de release**: fuente de verdad. No se copia; se consulta por GET con cache por hash (`sha256`). |

---

## Documentación

Todo está en [`AGENTS.md`](./AGENTS.md):

| § | Contenido |
|---|---|
| [1](./AGENTS.md#1-propósito) | Propósito, criterio de éxito, nota del nombre |
| [2](./AGENTS.md#2-ecosistema-qué-ya-existe) | Ecosistema y deuda de `wpipe-mcp` |
| [3](./AGENTS.md#3-pasado-lo-que-se-decidió-y-lo-que-se-descartó) | Decisiones tomadas y alternativas descartadas |
| [4](./AGENTS.md#4-visión-metas-y-el-loop-de-verificación) | Visión, las 4 capacidades, el loop de verificación, métricas |
| [5](./AGENTS.md#5-el-microservicio-objetivo) | Estructura del ZIP, los 2 dialectos de step, los 3 orígenes del canvas, los 3 bugs reales |
| [6](./AGENTS.md#6-diseño-técnico) | Arquitectura, IR de 3 niveles, seguridad del sandbox, Context por estado |
| [7](./AGENTS.md#7-reglas-del-repositorio) | 11 reglas del repo |
| [8](./AGENTS.md#8-estado-de-las-decisiones) | Estado de P1–P5 |
| [9](./AGENTS.md#9-hoja-de-ruta) | Hoja de ruta por sprints |
| [10](./AGENTS.md#10-anti-patrones) | Anti-patrones |
| [11](./AGENTS.md#11-referencias) | Referencias: golden examples, repos hermanos |
| [12](./AGENTS.md#12-pendientes) | Pendientes abiertos |

---

## Licencia

Ver [`LICENSE`](./LICENSE).
