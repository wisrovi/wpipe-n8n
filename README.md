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
- **Zod**: Validación de esquemas del IR en el frontend espejo de Pydantic.
- **Vite & Tailwind CSS**: Bundler ultrarrápido, utilidades CSS y componentes con tema oscuro profesional estilo Scratch 3.0 / Scratux.
- **Pytest & Pytest-Cov**: Suite de pruebas automatizadas con validación de cobertura de código (>90%).
- **Docker**: Entorno aislado y efímero para la ejecución de pruebas y verificación de calidad.

---

## Interfaz Visual, Bloques Dinámicos y Modo Simulación

La interfaz de `wpipe-studio` ofrece una experiencia visual estilizada inspirada en Scratch 3.0 / Scratux, optimizada para máxima productividad con bloques configurables:

1. **Barra Superior (Top Menu Bar)**: Selector de vistas (Bloques Blockly, Código Python del microservicio, DAG Visual Mermaid), menús de Archivo/Edición (Modo Turbo), título editable del proyecto, botones de verificación AST y descarga del ZIP.
2. **Paleta Visual de Bloques Puzzle (Scratch 3.0 / Scratux Toolbox)**:
   - Diseño visual de auténticas piezas de puzzle Scratch con pestañas de conexión, muescas de encaje y paleta de colores vibrantes sin cajas de texto invasivas.
   - **Popover descriptivo flotante (Hover Tooltip)**: al posar el cursor sobre cualquier bloque por unos instantes, se despliega una tarjeta enriquecida con la descripción del bloque, los parámetros configurables y el código Python WPipe equivalente.
   - 📦 **Paso de Catálogo (Universal)**: Bloque interactivo con selectores internos directos: filtrado por origen (`Oficiales` / `Plugins`), selector dinámico de categoría (`connectivity`, `database`, `security`, `vision`, etc.), filtro de búsqueda por texto y lista desplegable con los 196 steps del catálogo (incluyendo plugins comunitarios como `ecam_yolo`).
   - ✨ **Paso con IA (Dialecto A)**: Bloque para arrastrar y describir en lenguaje natural el comportamiento deseado. Genera la función decorada con `@step` y su Context DTO Pydantic (`app/dto/` y `app/states/`).
   - 📄 **Paso Personalizado (.py)**: Bloque con acción de adjunto de archivos Python locales (`.py`), empaquetándolos directamente en el microservicio.
   - 🔀 **Condición Si (Single Branch)**: Bloque de bifurcación condicional simple sin rama else (`Condition(expression=..., branch_true=[...])`).
   - 🔀 **Condición Si / Sino (Dual Branch)**: Bloque condicional completo con ramas `VERDADERA` y `FALSA`.
   - 🔁 **Bucle Mientras (While Loop)**: Bloque de repetición condicional continua (`For(validation_expression=..., steps=[...])`).
   - 🔁 **Bucle Repetir (For Loop)**: Bloque de repetición determinista N veces (`For(iterations=N, steps=[...])`).
   - ⚡ **Ejecución Paralela (Parallel)**: Bloque de concurrencia con política de fusión de contexto (`accumulate` o `last_wins`).
   - ⏳ **Segundo Plano (Background)**: Bloque de ejecución asíncrona no bloqueante en hilo secundario (`Background(step=...)`).
   - 📚 **Acceso al Catálogo Completo**: Modal con documentación completa, parámetros y ejemplos de los 196 steps.
3. **Área Central de Bloques (Blockly Canvas)**: Espacio de trabajo infinito con zoom, centrado, papelera y sincronización bidireccional inmediata con el IR intermedio.
4. **Etapa de Simulación (Simulation Stage)**:
   - Controles de ejecución: **Bandera Verde** (🏁 Run) y **Octágono Rojo** (🛑 Stop).
   - Secuencia de ejecución en tiempo real con resaltado visual animado del bloque activo en el canvas.
   - Simulador de Payload de entrada (JSON editable).
   - Inspector de Contexto en vivo: tabla comparativa de variables `read` y `write` con diff visual de estados.
   - Consola de logs de ejecución y medidores de tiempo.

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
