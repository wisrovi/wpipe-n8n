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

- **FastAPI**: Framework web asíncrono de alto rendimiento para la API backend (`/api/v1`).
- **Pydantic v2**: Validación de datos estricta y esquemas del IR (`CanvasIR`, `SemanticIR`, `TargetIR`).
- **React 18 & TypeScript**: Interfaz visual de usuario para el Canvas de diseño de pipelines y etapa de simulación.
- **Blockly (`blockly`)**: Motor de programación visual basado en bloques ensamblables, adaptado a la distribución visual de Scratux 3.0.
- **Lucide React (`lucide-react`)**: Iconografía para la barra superior, categorías y controles de ejecución.
- **Mermaid & @xyflow/react**: Visualización de grafos dirigidos (DAG) y arquitectura de pipelines.
- **PrismJS (`prismjs`)**: Motor de resaltado de sintaxis en tiempo real para Python, YAML, Dockerfile, Makefile, Bash y JSON con tema Tomorrow Night.
- **Zod**: Validación de esquemas del IR en el frontend espejo de Pydantic.
- **Vite & Tailwind CSS**: Bundler ultrarrápido, utilidades CSS y componentes con tema oscuro profesional estilo Scratch 3.0 / Scratux.
- **Pytest & Pytest-Cov**: Suite de pruebas automatizadas con validación de cobertura de código (>90%).
- **Docker**: Entorno aislado y efímero para la ejecución de pruebas y verificación de calidad.

---

## Interfaz Visual, Bloques Dinámicos, Modo Simulación y Navegación GitHub

La interfaz de `wpipe-studio` ofrece una experiencia visual estilizada inspirada en Scratch 3.0 / Scratux y GitHub.com, optimizada para máxima productividad con bloques configurables:

1. **Barra Superior (Top Menu Bar)**: Selector de 4 pestañas modulares (🧩 Canvas de Diseño, 🎮 Simulación & Depuración, 📊 Flujo Mermaid DAG y 💻 Microservicio Python), menús desplegables enriquecidos de Archivo y Edición (Colapsar/Expandir todos los bloques, Deshacer/Rehacer, Zoom to Fit, Modo Turbo, Guardar/Restaurar en localStorage, Exportar Canvas JSON y Descargar ZIP).
2. **Tira Lateral de Categorías Scratch 3.0 (Far Left Dot Column)**:
   - Selectores circulares temáticos por categoría: Inicio (Ámbar), Pasos (Azul), Control (Naranja), Bucles (Amarillo) y Paralelo (Esmeralda).
   - Botón de extensión icónico de Scratch 3.0 `[ + | ≡ ]` en la parte inferior para abrir la biblioteca de extensiones con los 197 steps y filtros por repositorio (Oficiales / Plugins).
3. **Paleta Visual de Bloques Puzzle (Scratch 3.0 / Scratux Toolbox)**:
   - Diseño visual de auténticas piezas de puzzle Scratch con pestañas de ensamble, muescas de encaje y paleta de colores vibrantes sin cajas de texto invasivas.
   - Buscador rápido en tiempo real para filtrar bloques al instante.
   - **Tarjeta descriptiva flotante (Hover Tooltip)**: al posar el cursor sobre cualquier bloque, se despliega una tarjeta enriquecida con la descripción del bloque, los parámetros configurables y el código Python WPipe equivalente generado.
   - 🚀 **Lanzador de Pipeline (Trigger Hat Block)**: Bloque sombrero de inicio que configura el punto de entrada al pipeline (FastAPI REST `POST /run`, Kafka Consumer, Redis Queue, Cron / Programador, Webhook, CLI local), reflejado automáticamente en diagramas Mermaid y en wrappers de ejecución en `app/main.py`.
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
6. **Navegador de Repositorio Estilo GitHub.com (Microservicio Python)**:
   - Navegación idéntica a la experiencia de exploración de repositorios en **github.com**:
     - Selector de rama git `🏷️ main`.
     - Barra interactiva de migas de pan (breadcrumbs) con segmentos clicables (`wpipe_microservice / app / dto / step_dto.py`).
     - Banner de commit estilo GitHub con autor, mensaje de commit, hash y badge de verificación.
     - Vista de tabla de directorio con iconos tipados (🐍 Python, 🐳 Docker, ⚙️ Config/TOML, 📝 Markdown, 💻 Shell script), commit message por archivo, tamaños y enlace `..` para subir de carpeta.
     - Visor de archivos (Blob viewer) interactivo con canal izquierdo de números de línea, selector de modo Raw, botones para copiar y descargar el archivo individual.
     - **Resaltado de Sintaxis en Tiempo Real (PrismJS)**: coloreado de código para Python (imports, clases, decoradores, funciones), Dockerfile, Makefile, YAML, Bash y JSON.
     - **Edición en Navegador**: Botón para editar cualquier archivo generado directamente en el navegador con soporte para tabulación (4 espacios), números de línea sincronizados e indicador visual de archivos modificados (`Editado`) tanto en la tabla como en el visor y árbol de archivos.
     - **Makefile Orientado a Microservicio Docker**: Comandos listos para producción (`make start` con `docker-compose up -d --build`, `make stop`, `make restart`, `make status`, `make logs`, `make test`, `make build`, `make shell`, `make clean`).
     - **Resolución Completa de Pipelines (`pipelines.py`)**: Algoritmo topológico jerárquico con `get_root_ancestor_id` y `order_children_for_slot` que garantiza que los pasos posteriores a bloques de control (C-blocks: Condition, For, While, Parallel, Background) nunca se pierdan en el código generado.
     - **Selector Rápido de Imagen Base Docker**: Barra interactiva sobre `Dockerfile` para alternar entre presets (`python:3.11-slim`, `python:3.12-slim`, `python:3.10-slim`, `python:3.11 Full`, `nvidia/cuda:12.1.0-runtime-ubuntu22.04`, `FastAPI Prod`) o ingresar tags personalizados con reemplazo reactivo de la directiva `FROM`.
     - **Generación Automática de `docker-compose.yml` y `__init__.py`**: Incluye orquestación Docker con healthcheck HTTP y archivos `__init__.py` estructurados con versiones y exports.
     - **Descarga de Paquete (.zip)**: Endpoint `/api/v1/pipeline/generate-from-files` que preserva las ediciones manuales del usuario en el archivo ZIP descargado.
     - Previsualización incrustada de `README.md` bajo la tabla de directorio.
     - Panel lateral izquierdo de árbol de archivos (`buildFileTree`) con botón de alternancia.
     - Buscador global instantáneo "Go to file" para localizar cualquier archivo del microservicio al escribir su nombre.
7. **Lienzo Inicial Hello World con los 10 Bloques**:
   - Al cargar o recargar el lienzo, se precarga automáticamente un flujo simple "Hello World" que demuestra la integración de los 10 bloques (Trigger Ingress, Step HttpRequest, AI Step, User File Step, IF, Parallel con MySQLQuery, IF-ELSE con For, Background con RedisGet, y While con NmapScanStep).

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
