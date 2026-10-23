# PLAN.md — wpipe-studio

> **Documento vivo de planificación técnica**. Define el qué, por qué, cómo, cuándo
> (sprints) y las dependencias para construir `wpipe-studio`: un SaaS multi-tenant
> estilo n8n para diseñar pipelines WPipe y generar microservicios verificados y
> descargables como ZIP.

## Índice

- [1. Resumen Ejecutivo](#1-resumen-ejecutivo)
- [2. Objetivo y Alcance](#2-objetivo-y-alcance)
- [3. Principios de Diseño](#3-principios-de-diseño)
- [4. Estado Actual del Ecosistema (Baseline)](#4-estado-actual-del-ecosistema-baseline)
- [5. Arquitectura del Sistema](#5-arquitectura-del-sistema)
- [6. Catálogo de Steps — Manifiesto de Release (JSON)](#6-catálogo-de-steps--manifiesto-de-release-json)
- [7. Modelo de Datos e IR (Intermediate Representation)](#7-modelo-de-datos-e-ir-intermediate-representation)
- [8. Seguridad, Sandbox y Multi-Tenancy](#8-seguridad-sandbox-y-multi-tenancy)
- [9. Loop de Verificación y Calidad](#9-loop-de-verificación-y-calidad)
- [10. Canvas Visual (React + xyflow)](#10-canvas-visual-react--xyflow)
- [11. Agentes (LLM) con Tool-Use + MCP](#11-agentes-llm-con-tool-use--mcp)
- [12. Microservicio Generado (ZIP Objetivo)](#12-microservicio-generado-zip-objetivo)
- [13. Stack Tecnológico](#13-stack-tecnológico)
- [14. Roadmap por Sprints](#14-roadmap-por-sprints)
- [15. Métricas de Éxito, KPIs y Alertas](#15-métricas-de-éxito-kpis-y-alertas)
- [16. Riesgos, Supuestos, Mitigaciones y Dependencias](#16-riesgos-supuestos-mitigaciones-y-dependencias)
- [17. Organización de Carpetas (Monorepo)](#17-organización-de-carpetas-monorepo)
- [18. Definition of Done (DoD) y Definition of Ready (DoR)](#18-definition-of-done-dod-y-definition-of-ready-dor)
- [19. Decisiones Técnicas (ADRs Resumidas)](#19-decisiones-técnicas-adrs-resumidas)
- [20. Referencias](#20-referencias)

---

## 1. Resumen Ejecutivo

`wpipe-studio` es un SaaS multi-tenant tipo n8n que permite diseñar pipelines WPipe
en un canvas visual y generar microservicios Python **verificados**. La innovación
clave es el **loop de verificación obligatorio**: cada microservicio generado debe
superar black/isort/ruff/mypy/pylint/pytest (cov ≥ 60%) y un `dry_run_pipeline` antes
de habilitar su descarga en ZIP.

**Principio arquitectónico crítico:** el catálogo de `wpipe-steps` **NO se copia ni se
re-deriva**. `steps_catalog.json` es el **manifiesto de release**: declara
exactamente qué steps están **publicados y soportados**. Lo que no está en el JSON está
**en desarrollo** y no se ofrece. `wpipe-studio` **consulta el manifiesto en cada
`GET`** (con cache por hash + ETag). Cuando `wpipe-steps` publica un step nuevo y
regenera el manifiesto, el siguiente `GET` ya lo devuelve — **sin parche en
wpipe-studio**.

> ⚠️ **Nunca derivar el catálogo recorriendo el filesystem.** Eso expondría steps en
> desarrollo. Ver §6.1 y §6.3.

---

## 2. Objetivo y Alcance

### 2.1 Objetivo

Reducir el tiempo y la fricción para crear microservicios WPipe funcionales y
production-ready, asegurando que lo generado **funciona de punta a punta** (no solo
compila).

### 2.2 Alcance (MVP)

- Canvas visual (nodos: `step`, `condition`, `for`, `parallel`)
- Generación de microservicio completo (ZIP) con Docker/Makefile/tests
- Batería de calidad obligatoria + `dry_run_pipeline`
- Multi-tenant (org_id + RLS)
- Sandbox Docker efímero por ejecución
- Catálogo de `wpipe-steps` vía su manifiesto de release (`steps_catalog.json`)

### 2.3 Fuera de Alcance (confirmado)

- `app/gui.py` — **NO** se genera ([DECIDIDO] P2)
- `report.md` — **NO** se genera ([DECIDIDO] P2)
- `app/start.sh` — reemplazado por `CMD ["python3","main.py"]` en Dockerfile
- Auditar/reparar `wpipe-steps` — se consume tal cual ([DECIDIDO])

---

## 3. Principios de Diseño

1. **IR es única fuente de verdad** (CanvasIR ↔ SemanticIR ↔ TargetIR)
2. **Verificación antes de entrega**: sin pasar gates → sin ZIP (§1.1)
3. **Trust but enrich**: `wpipe-steps` es base sólida y **curada**. Se consume tal cual;
   el AST solo enriquece lo ya publicado. **Nunca se juzga ni se audita**
4. **El manifiesto manda**: `steps_catalog.json` es la release curada. No se copia,
   no se re-deriva, no se amplía. Solo se consulta
5. **Fail loudly**: manifiesto ilegible → error explícito, **nunca** catálogo vacío.
   Un entry no parseable → `index_ok=False`, **no bloquea**
6. **Secure by default**: todo código usuario corre **solo** en sandbox Docker (§8)
7. **SRP**: Context **uno por estado** en `dto/` (§6.7 AGENTS.md)
8. **Honestidad del contrato**: `ContextContract.inferred`
   (`exact|trusted|heuristic|declared`) — el aviso se reserva para código **del usuario**
9. **Artefactos derivados no son contrato**: YAML de `config_dir` nunca es contrato

---

## 4. Estado Actual del Ecosistema (Baseline)

### 4.1 Repos y versiones

| Repo | Versión | Observación |
|---|---|---|
| `wpipe` | 2.5.8 | Runtime |
| `wpipe-steps` | — | **196 steps en release** (manifiesto `steps_catalog.json`). **192 namespaces** verificados contra el código |
| `wpipe-plugins` | — | 1 step |
| `wpipe-mcp` | 0.4.1 | 11 tools. Deuda: lógica inline en `server.py` (1196 L) → extraer a módulos puros |
| `wpipe-api` | — | Referencia |

### 4.2 Verificación del manifiesto contra el código (hecho)

Crucé las 196 filas de `steps_catalog.json` contra el árbol de `wpipe_steps/`:

| Comprobación | Resultado |
|---|---|
| Namespaces en el manifiesto | **193** |
| Namespaces con step en el código | **192** |
| **Steps en código ausentes del manifiesto** | **0** ✅ |
| Namespaces del manifiesto sin step en código | 1 → `wpipe_steps.utils.read_yaml` (sin `states/`) |
| Categorías del manifiesto | 10 (ver abajo) |

**El manifiesto es exacto.** Cero steps en código fuera del manifiesto: no hay
filtración de trabajo en desarrollo. La única discrepancia es
`utils/read_yaml`, sin directorio `states/` — se reporta como **incidencia de
manifiesto**, no como bug de wpipe-studio (§6.5).

**Distribución por categoría (release):**

```text
database 101 · ai 52 · communication 9 · connectivity 6 · infrastructure 6
security 6 · data 5 · multimedia 5 · system 5 · utils 1        TOTAL 196
```

**Datos structurally útiles, verificados:**

| Métrica | Valor | Consecuencia |
|---|---|---|
| Steps con `__init__` parseable | **196 / 196** | Panel de config del canvas **100% estático**, sin LLM |
| Steps con `response_key` literal | **92 / 192** | `write` derivable sin heurística en casi la mitad |
| Claves de contrato en el manifiesto | **0 de 16** | Son descriptivas; la firma sale del código |

### 4.3 Golden Examples

- `extra_metadata_face`: lineal, 6 states, 1827 LOC, tests en `app/tests/`
- `embedding`: 2 pipelines + bucles `For`, 2459 LOC, tests en `tests/` (estandarizar → `app/tests/`)

Bugs a evitar: repr() en YAML, `merge_policy` contradictorio, context global.

---

## 5. Arquitectura del Sistema

### 5.1 Diagrama de Alto Nivel

```text
Browser (React 19 + @xyflow/react)
  └─ REST + WS (SSE/streaming agente)
FastAPI (Backend)
  ├─ Auth (Clerk/Supabase) — multi-tenant (org_id + RLS)
  ├─ IR Service (Pydantic v2) — CanvasIR/SemanticIR/TargetIR
  ├─ Catalog Service — lee steps_catalog.json (manifiesto) + enrich AST
  ├─ Agent Orchestrator (tool-use) — llama a wpipe-mcp / tools internos
  ├─ Job Queue (Celery + Redis) — trabajos largos (generación+verificación)
  └─ Storage (Postgres async SQLAlchemy + S3/minIO para ZIPs)
Sandbox (Docker efímero por ejecución)
  ├─ Batería de calidad (black,isort,ruff,mypy,pylint,pytest cov≥60%)
  ├─ dry_run_pipeline
  └─ Empaquetado ZIP + cleanup garantizado (finally)
```

### 5.2 Capas de IR (crítico)

| Nivel | Propósito | No va al generador |
|---|---|---|
| **CanvasIR** | Grafo visual (nodos,posiciones,aristas,viewport) | posiciones/layout |
| **SemanticIR** | Semántica (tipos, contratos, `origin`, `inferred`, `merge_policy`) | UI-only |
| **TargetIR** | Proyecto a emitir (archivos, imports, estructura) | — |

Transformación unidireccional: `CanvasIR → SemanticIR → TargetIR → ZIP`.

---

## 6. Catálogo de Steps — Manifiesto de Release (JSON)

### 6.1 Principio (inmutable)

> **Owner:** *"El JSON es la realidad. Por eso algunos estados no están allí porque
> están en desarrollo; por eso el GET/POST para obtener la lista estable."*

`wpipe-steps/steps_catalog.json` es el **manifiesto de release**: la lista curada y
soportada de steps. **Es la única fuente de verdad del catálogo.**

Corolarios, todos `[DECIDIDO]`:

| Regla | Consecuencia |
|---|---|
| El manifiesto es la verdad | `wpipe-studio` **no copia** el JSON a su repo |
| Un step no listado no existe | Lo que está solo en código está **en desarrollo** → **no se ofrece** |
| El manifiesto se regenera al publicar | `pip install -U wpipe-steps` → el siguiente `GET` ya trae el step nuevo |
| Actualizar no es parchear | **Cero commits en `wpipe-studio`** para añadir steps |

> 🔴 **Prohibido derivar el catálogo recorriendo el filesystem.** Un escaneo AST del
> árbol expondría trabajo en curso como si fuera producto. El AST se usa **solo para
> enriquecer entries ya publicadas** (§6.4).

### 6.2 Por qué NO se copia el JSON

Copiar sería un snapshot congelado: habría que re-sincronizarlo en cada release de
`wpipe-steps`, y el drift sería silencioso — un snapshot al que le falta un step no
se nota hasta que un usuario no lo encuentra en el canvas.

### 6.3 Las dos fuentes, y cuál manda

| Fuente | Papel | Autoridad |
|---|---|---|
| `steps_catalog.json` | **Qué steps existen** (release) | ✅ **Manda** |
| `ast` sobre `states/*.py` | **Cómo se configuran** (firma, defaults, `response_key`) | Complementaria |

El manifiesto **no** publica contrato: sus 16 claves son descriptivas (`name`,
`func_name`, `namespace`, `version`, `description`, `license`, `repo`, `author`,
`examples`, `environment`, `requirements`, `how_to_use`, `category`,
`subcategory1..3`). **Ninguna es `reads`/`writes`.** Por eso el AST es necesario — pero
**solo para las entries que el manifiesto ya declara**.

> Verificado: **0 steps en código ausentes del manifiesto** (§4.2). El riesgo de
> discrepancia es hoy teórico; el diseño lo cubre igual.

### 6.4 Enriquecimiento por AST (acotado al manifiesto)

Para cada fila del manifiesto se parsea **solo** su `namespace/func_name`:

```python
class CatalogEntry(BaseModel):
    # ── del manifiesto (autoridad) ───────────────────
    cls: str            # func_name
    ns: str             # namespace
    cat: str            # category
    version: str
    description: str
    requirements: list[str]
    # ── del AST (enriquecimiento, tolerante a fallo) ─
    module: str | None          # wpipe_steps.ai.audio.asr.states.asr
    params: list[ParamSpec]     # de __init__ → alimenta el panel del canvas
    response_key: str | None    # default literal
    dialect: Literal["B"] = "B"
    index_ok: bool = True
```

**Reglas del enriquecimiento:**

- Se parsea **`namespace` del manifiesto**, nunca se recorre el árbol.
- Si un entry no parsea → `index_ok=False` + warning. **No se oculta ni se bloquea.**
- La identidad es `(namespace, func_name)`, **nunca el nombre de clase solo**: hay
  nombres repetidos entre variantes async/sync (Redis).
- `func_name` del manifiesto puede no coincidir con la clase actual
  (`GraphQLContext` en JSON vs `GraphQLQueryStep` en código) → se resuelve por
  *namespace + coincidencia normalizada* y se reporta el drift.

### 6.5 Incidencia conocida (no bloquea)

`wpipe_steps.utils.read_yaml` está en el manifiesto pero **no tiene `states/`**.
El GET lo devuelve (el manifiesto manda) y el panel de config sale vacío. Se reporta
al owner de `wpipe-steps`; **sin workaround en `wpipe-studio`**.

### 6.6 Cache y rendimiento

- **Cache key**: `sha256(steps_catalog.json)`, no el árbol de fuentes.
- **Validación**: `If-None-Match` / ETag → el cliente recibe `304` sin payload.
- **Warm**: 0ms desde Redis. **Cold**: leer + parsear solo los 196 entries (< 50ms, sin
  importar el paquete).
- **Fail-safe**: manifiesto ilegible → **error explícito**, no catálogo vacío. Un
  catálogo vacío silencioso es peor que un 500.
- `POST /catalog/refresh` **solo invalida caché**. Nunca amplía la lista.

### 6.7 API de catálogo (Backend)

| Endpoint | Método | Descripción |
|---|---|---|
| `/catalog/steps` | GET | Lista de release (filtrable `q, cat, group`) |
| `/catalog/steps/{namespace}/{func_name}` | GET | Detalle + `params` del AST |
| `/catalog/categories` | GET | `{cat: count}` desde el manifiesto |
| `/catalog/refresh` | POST | Invalida caché (**no** añade steps) |

Respuesta: `source: "manifest+ast"`, `manifest_version`, `manifest_sha`, `count_total`,
`cache_hit`.

---

## 7. Modelo de Datos e IR (Intermediate Representation)

### 7.1 StepOrigin (enum)

```python
class StepOrigin(str, Enum):
    catalog      = "catalog"        # pip (wpipe-steps/plugins)
    user_imported= "user_imported"  # upload .py (Dialecto A/B)
    described    = "described"       # generado por IA (Dialecto A)
```

Color derivado: `catalog` verde, `user_imported` azul, `described` ámbar.

### 7.2 ContextContract + inferred

```python
class Inferred(str, Enum):
    exact     = "exact"      # Dialecto A (@to_obj + cuerpo) o declarado por el autor
    trusted   = "trusted"    # origin=catalog, Dialecto B del manifiesto. Opaco por diseño
    heuristic = "heuristic"  # .py del usuario, Dialecto B (data[...])
    declared  = "declared"   # el usuario lo rellena a mano

class ContextContract(BaseModel):
    reads: set[str] = Field(default_factory=set)
    writes: set[str] = Field(default_factory=set)
    inferred: Inferred
    notes: str | None = None
```

**El validador del IR solo avisa donde el código no es confiable:**

| `origin` | Acción |
|---|---|
| `catalog` | **Confía.** Sin auditoría ni warnings (§3.3 trust-but-enrich) |
| `user_imported` + `heuristic` | **Avanza con warning visible** |
| `described` | Valida normal (contrato recién generado) |

El default **nunca** es `heuristic`: se deriva del `origin`. Un `catalog` jamás
arrastra ruido de warnings que el usuario aprendería a ignorar.

**Regla:** si `inferred == heuristic` → mostrar advertencia en UI (no bloquea). Si
`inferred == exact` → confianza alta.

### 7.3 StepNode (SemanticIR)

```python
class StepMeta(BaseModel):
    name: str; version: str="v1.0"; timeout: int|None=None
    description: str=""; tags: list[str]=[]
    retry_count: int=0; retry_delay: float=0.1

class StepNode(BaseModel):
    id: str
    name: str; module: str; class_name: str
    origin: StepOrigin
    contract: ContextContract
    kwargs: dict[str,Any]=Field(default_factory=dict)
    step_meta: StepMeta
    position: dict[str,float]|None=None  # CanvasIR only
```

### 7.4 Tipos de Nodo (grafo)

```python
NodeKind = Literal["step","condition","for","parallel"]

class ForNode(BaseModel):
    kind: Literal["for"]="for"
    expression: str
    iterations: int|None=None
    merge_policy: Literal["accumulate","last_wins"]="accumulate"
    body: list[IRNode]

class ParallelNode(BaseModel):
    kind: Literal["parallel"]="parallel"
    branches: list[list[IRNode]]
```

`merge_policy` **explícito** (evita Bug 2). Validado en SemanticIR.

### 7.5 Capas IR (modelos)

```python
class CanvasIR(BaseModel):      # Nivel 1
    nodes: list[dict]; edges: list[dict]; viewport: dict|None=None

class SemanticIR(BaseModel):    # Nivel 2
    name: str; version: str="1.0.0"
    nodes: list[IRNode]; edges: list[IREdge]
    settings: dict[str,Any]={}

class TargetIR(BaseModel):      # Nivel 3
    project_name: str; app_path: str="app"
    states: list[GenState]; dto: list[GenDTO]; pipelines: GenPipelines
    docker: GenDocker; makefile: GenMakefile; reqs: list[str]
```

Validaciones SemanticIR: DAG acíclico, referencias válidas, `merge_policy` presente
en `for`, contratos consistentes entre aristas.

---

## 8. Seguridad, Sandbox y Multi-Tenancy

### 8.1 Sandbox Docker (obligatorio, por ejecución)

Contenedor efímero, destruido en `finally`:

| Restricción | Flag/Config | Razón |
|---|---|---|
| Sin privilegios | `--privileged=false`, `--cap-drop=ALL` | Principio menor privilegio |
| Sin socket Docker | no montar `/var/run/docker.sock` | Escape |
| Red | `--network=none` (default). Allowlist solo para modelos (p.ej. HuggingFace) vía `--network=bridge` + egress limitado | RCE/Exfiltración |
| CPU | `--cpus=1.0`–`2.0` (configurable por tier) | DoS |
| RAM | `--memory=2g`, `--memory-swap=2g` (sin swap) | OOM |
| PID | `--pids-limit=256` | Fork bomb |
| Tiempo | timeout duro (wall + CPU) + `TaskTimer` interno | Hangs |
| FS | tmpfs/volume con quota, read-only donde posible | I/O abuse |
| Usuario | non-root (`uid!=0`) | Hardening |
| Cleanup | `docker rm -f` SIEMPRE en `finally` + GC periódico | Fugas |

### 8.2 Multi-Tenancy

- **Org-based**: `org_id` (UUID) en **TODAS** las tablas (tenant_id obligatorio)
- **RLS (Row Level Security)** en Postgres: políticas por `org_id` + `user_id`
- **Isolation**: trabajos, ZIPs, logs por `org_id`
- **Quotas**: ejecuciones/hora, MB/ZIP, tiempo total por org (SaaS tiers)
- **Secrets**: nunca host creds. Variables efímeras por job. Sin persistir código
  sensible en logs.

### 8.3 Parser de `.py` subidos (P4a)

Solo `ast.parse` (sin `eval/exec`). Procesado **en el sandbox** (P5: opción (a),
`[DECIDIDO]` confirmado). No preview síncrono requerido; contrato aparece tras parseo validado.

---

## 9. Loop de Verificación y Calidad

### 9.1 Gates obligatorios (orden estricto)

| Paso | Herramienta | Umbral/Regla | Fallo → agente reparador |
|---|---|---|---|
| 1 | `black` | --check (formateo) | Sí |
| 2 | `isort` | --check-only | Sí |
| 3 | `ruff` | lint (sin ignores de conveniencia) | Sí |
| 4 | `mypy` | strict (donde aplica) | Sí |
| 5 | `pylint` | `.pylintrc` del proyecto (max-line-length=100) | Sí |
| 6 | `pytest` | unit + integration, **cov ≥ 60%** | Sí |
| 7 | `dry_run_pipeline` | ejecución real end-to-end (vía `wpipe-mcp.dry_run_pipeline` o wrapper) | **Sí (prueba final)** |

**Inviolable:** si falla cualquier paso → **no hay ZIP**. Errores se pasan **verbatim**
al agente reparador (stacktrace + stdout/stderr).

### 9.2 Presupuestos de iteración

| Config | Valor sugerido | Acción si se supera |
|---|---|---|
| `MAX_REPAIR_ATTEMPTS` | 5 | Escalar a humano + log completo |
| `MAX_TIME_PER_JOB` | 900s (15m) | Timeout + cleanup |
| `MAX_FILES` | 40 | Evitar explosión |

### 9.3 Estándares de tests

- Tests en `app/tests/` (estandarizar vs `tests/` raíz)
- `test_pipeline.py` debe detectar rotura del pipeline
- Unitarios puros (sin red), integración aislada en sandbox

---

## 10. Canvas Visual (React + xyflow)

### 10.1 Tecnologías

- **Frontend**: React 19 + TypeScript
- **Canvas**: `@xyflow/react` (v12+)
- **Estado**: Zustand/Redux Toolkit
- **UI**: shadcn/ui + Tailwind
- **Validación**: Zod (IR)

### 10.2 Paleta por origen (obligatoria)

| `StepOrigin` | Color | Badge | Tooltip |
|---|---|---|---|
| `catalog` | Verde (#22c55e) | "Catalog" | Instalado via pip (wpipe-steps) |
| `user_imported` | Azul (#3b82f6) | "Imported" | Subido (.py) — parseado AST |
| `described` | Ámbar (#f59e0b) | "AI-generated" | Pendiente de generar+verificar |

Regla: color **derivado** de `origin`. Nunca persistido aparte.

### 10.3 Nodos y inspector

- Tipos: `step`, `condition`, `for`, `parallel`
- Panel Inspector: muestra `params` desde el **enriquecimiento AST** de las entries
  publicadas por el manifiesto, para `catalog`,
  o desde parseo para `user_imported`. Para `described`: campos libres + validación.
- `merge_policy` visible/editable en nodo `for`
- Advertencia UI cuando `contract.inferred == 'heuristic'`

### 10.4 Flujo Canvas ↔ IR

`CanvasIR` (xyflow) → `enrich()` → `SemanticIR` (validado Zod) → `resolve()` → `TargetIR`
→ Backend (agente). Transformación unidireccional, sin retroalimentación sucia.

---

## 11. Agentes (LLM) con Tool-Use + MCP

### 11.1 Orquestación

- **Planificador**: descripción → plan de trabajo (fases, archivos, riesgos)
- **Generador**: TargetIR → código completo (Dialecto A para estados nuevos)
- **Reparador**: recibe errores verbatim → itera hasta pasar gates (≤5 intentos)
- **Streaming**: WS/SSE para mostrar progreso en tiempo real

### 11.2 Herramientas

- **Internas**: Catalog Service (manifiesto + enrich), IR Validator, Zip Builder
- **Externas (MCP)**: `wpipe-mcp` (11 tools). **Prioritario refactor** (§2.2 AGENTS.md):
  extraer lógica inline de `server.py` (1196L) a módulos puros (`validators.py`,
  `codegen.py`, `testgen.py`, `docgen.py`, `optimizer.py`, `dryrun.py`), wrapper delgado.

### 11.3 Decisión de dialecto

- **Estados nuevos (`described`)**: **Dialecto A** (`@step` + `@to_obj(Context)` + DTO en `dto/`)
- **Consumidos (`catalog`, `user_imported`)**: respetan su dialecto (B mayoritario)
- **Parser de `.py` del usuario**: AST puro, corre en **sandbox** (P5a, confirmado)
- **Catálogo**: lectura del manifiesto de release + enrich; **nunca** escaneo del árbol

---

## 12. Microservicio Generado (ZIP Objetivo)

### 12.1 Estructura

```text
<microservice>/
├── Dockerfile
├── docker-compose.yml
├── Makefile                # 9 targets (help/install/dev/build/up/down/logs/test/lint/format)
├── requirements.txt
├── .dockerignore
├── README.md                # generado por document_wpipe_project (MCP)
└── app/
    ├── main.py
    ├── pipelines.py         # ★ debe funcionar
    ├── .pylintrc            # max-line-length=100
    ├── pipelines.wpipe.mermaid
    ├── configs/
    │   ├── settings.py
    │   └── *.yaml           # artefacto derivado (NO contrato)
    ├── dto/                 # Context POR ESTADO (SRP)
    ├── states/              # 1 archivo = 1 estado + error_capture.py
    ├── utils/
    └── tests/               # estandarizar en app/tests/ (vs raíz)
```

### 12.2 Reglas de generación

- Context **uno por estado** en `dto/` → elimina `base_face_state.py` + `ensure_context`
- YAML nunca usado como contrato (serializar `module:ClassName`)
- Incluir `error_capture.py` + `pipeline.add_error_capture([...], break_on_error=True)`
- Soportar **varios pipelines** por microservicio (embedding tiene 2)

---

## 13. Stack Tecnológico

| Capa | Tecnología | Versión/Notas |
|---|---|---|
| Frontend | React + TypeScript + Vite | React 19, `@xyflow/react` |
| UI | shadcn/ui + Tailwind CSS | |
| Backend | FastAPI + Uvicorn | async |
| ORM/DB | SQLAlchemy 2.0 async + Alembic | Postgres 15+ |
| Auth | Clerk (o Supabase Auth) | multi-tenant |
| Queue | Celery + Redis | jobs generación+verificación |
| Storage | S3/MinIO | ZIPs temporales (TTL) |
| LLM | Claude (tool-use) | MCP integrado |
| Pagos | Stripe | SaaS tiers (futuro) |
| Infra | Docker + Docker Compose | sandbox + servicios |
| Calidad | black,isort,ruff,mypy,pylint,pytest+coverage | gates obligatorios |

---

## 14. Roadmap por Sprints

### Sprint 0 — Cimientos (1 semana) — DoR completo

- [x] `git remote` → `git@github.com:wisrovi/wpipe-studio.git` + sync con `origin/main` (§12.3 AGENTS.md)
- [ ] Scaffold monorepo: `backend/`, `frontend/`, `sandbox/`, `shared/` (tipos TS/Pydantic)
- [ ] Auth multi-tenant (org_id + RLS) + modelos base
- [ ] **Catalog Service**: leer `steps_catalog.json` como manifiesto + enrich AST de
      las entries publicadas + cache por `sha256(manifiesto)` + endpoints
- [ ] IR Pydantic v2 (CanvasIR/SemanticIR/TargetIR) + validadores Zod
- [ ] CI base (lint/types mínimos)

### Sprint 1 — Loop de Verificación (2 semanas) — Núcleo

- [ ] **Refactor `wpipe-mcp`** (bloqueante): extraer lógica inline → módulos puros + wrapper delgado
- [ ] **Sandbox Docker** con todos los controles (§8.1) + cleanup garantizado
- [ ] Worker Celery (jobs largos) + Redis
- [ ] Agente generador + reparador (errores verbatim, ≤5 intentos)
- [ ] `dry_run_pipeline` wrapper + empaquetado ZIP (TTL)
- [ ] E2E happy path: descripción → ZIP verificado

### Sprint 2 — Canvas (2 semanas)

- [ ] React 19 + `@xyflow/react`, paleta 3 colores por `origin`
- [ ] CanvasIR ↔ SemanticIR (bidireccional controlado)
- [ ] Inspector con params desde el enriquecimiento del manifiesto
- [ ] Streaming WS/SSE de progreso agente
- [ ] Guardado/autoguardado de IR por proyecto

### Sprint 3 — Estados Nuevos + Importados (2 semanas)

- [ ] Parser AST `.py` subidos (sandbox) + detección Dialecto A/B
- [ ] `ContextContract.inferred` + advertencias UI
- [ ] Generación Dialecto A (DTO en `dto/`, sin `ensure_context`)
- [ ] Resolver drift `func_name` manifiesto↔código y reportarlo al owner de `wpipe-steps`
- [ ] Tests de parser + casos borde (código muerto)

### Sprint 4 — Hardening + SaaS (1–2 semanas)

- [ ] Quotas por org, rate limiting, auditoría
- [ ] Observabilidad (logs/metrics/traces)
- [ ] Cleanup ZIPs TTL + GC contenedores
- [ ] Documentación técnica + ejemplos end-to-end

---

## 15. Métricas de Éxito, KPIs y Alertas

| KPI | Objetivo | Fuente | Alerta si |
|---|---|---|---|
| Tasa éxito 1ª generación | ≥ 40% | jobs | < 30% (7d) |
| ZIP verificados / generados | 100% | jobs.status | < 100% (cualquier breach) |
| Tiempo hasta ZIP (1–3 steps) | < 5m | duration | > 8m (p95) |
| Tiempo hasta ZIP (10+ steps) | < 15m | duration | > 25m (p95) |
| Pasos iteración promedio | ≤ 2.5 | repair_attempts_avg | > 3.5 (7d) |
| Cobertura pytest | ≥ 60% | coverage | < 60% (bloquea ZIP) |
| % jobs con timeout | < 2% | timeouts | > 5% (1h) |
| % catalog cache hits | ≥ 90% | catalog | < 80% (1h) |
| Tiempo lectura+enriquecimiento manifiesto (cold) | < 50ms | catalog | > 150ms (p95) |

---

## 16. Riesgos, Supuestos, Mitigaciones y Dependencias

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| RCE por código usuario | Baja (sandbox) | Alto | Docker efímero + no-priv + network none + caps drop + timeouts + cleanup |
| Divergencia manifiesto↔código | Baja (verificada: 0 steps huérfanos) | Bajo | Reportar al owner de `wpipe-steps`; el manifiesto manda |
| Step en desarrollo visible por error | — (controlado) | Alto | 🔴 Prohibido derivar el catálogo del filesystem (§6.1) |
| Parser infiere campos fantasma (código muerto) | Media | Bajo | Respetar alcanzabilidad (no recorrer tras return inalcanzable) + tests |
| Deps pesadas (HF/torch) en dry_run | Media | Alto | Allowlist red + timeouts + CPU/RAM + cache modelos (volúmenes) |
| Refactor `wpipe-mcp` retrasa Sprint 1 | Alta | Alto | **Bloqueante** pero acotado (extraer a módulos puros, wrapper delgado). Plan paralelo si necesario |
| Fugas de contenedores/ZIPs | Baja | Alto | `try/finally` + TTL (1h) + GC periódico + quotas |

**Supuestos:** `wpipe-steps` estable (se consume). Docker disponible. Redis/Postgres operativos.

**Dependencias bloqueantes:** Sprint 1 requiere refactor `wpipe-mcp`.

---

## 17. Organización de Carpetas (Monorepo)

```text
wpipe-studio/
├── AGENTS.md        # reglas + contexto (ya existe)
├── PLAN.md          # este documento
├── README.md        # TOC (ya existe)
├── LICENSE
├── .gitignore
├── backend/         # FastAPI + Celery + SQLAlchemy
│   ├── app/
│   │   ├── api/ (v1)
│   │   ├── core/ (config, security)
│   │   ├── models/ (DB)
│   │   ├── schemas/ (Pydantic)
│   │   ├── services/ (catalog, ir, jobs)
│   │   ├── workers/ (celery)
│   │   └── main.py
│   ├── alembic/
│   └── pyproject.toml
├── frontend/        # React + Vite + xyflow
│   ├── src/
│   │   ├── components/canvas
│   │   ├── lib/ir
│   │   └── app
│   └── package.json
├── shared/          # Tipos compartidos (Zod/Pydantic/TS)
├── sandbox/         # Dockerfiles + scripts de gates
└── docs/            # ADRs, diagramas
```

> `PROJECT_MAP.md` se actualiza **cuando exista estructura real** (regla §2 AGENTS.md).

---

## 18. Definition of Done (DoD) y Definition of Ready (DoR)

### DoR (Story lista)
- [ ] User story clara + aceptación
- [ ] Diseño afecta IR o afecta gates? Definido
- [ ] Mockups si UI (canvas/inspector)
- [ ] Dependencias identificadas

### DoD (Feature completa)
- [ ] Código pasa lint/types (backend/frontend)
- [ ] Tests unitarios + integración relevantes
- [ ] Gates pasan en sandbox (black/isort/ruff/mypy/pylint/pytest cov≥60%)
- [ ] `dry_run_pipeline` OK para caso feliz
- [ ] IR validado (Zod/Pydantic) + DAG acíclico
- [ ] Seguridad: sin secretos, sandbox aplicado
- [ ] Docs actualizadas (AGENTS.md si cambia decisión, PLAN.md si roadmap)
- [ ] ZIP generado y descargable funciona end-to-end

---

## 19. Decisiones Técnicas (ADRs Resumidas)

| ADR | Decisión | Estado |
|---|---|---|
| ADR-001 | IR 3 niveles (Canvas/Semantic/Target) | [DECIDIDO] |
| ADR-002 | Catálogo = **manifiesto `steps_catalog.json`** + enrich AST. No copiar, no derivar del árbol | [DECIDIDO] |
| ADR-011 | Manifiesto ilegible → error explícito, nunca catálogo vacío | [DECIDIDO] |
| ADR-003 | Context 1 por estado en `dto/` (Dialecto A) | [DECIDIDO] |
| ADR-004 | Orígenes 3 (catalog/user_imported/described) + color derivado | [DECIDIDO] |
| ADR-005 | Parser `.py` en **sandbox** (P5a) | [DECIDIDO] |
| ADR-006 | Gates obligatorios + dry_run antes de ZIP | [DECIDIDO] |
| ADR-007 | Sandbox Docker efímero por ejecución | [DECIDIDO] |
| ADR-008 | Multi-tenant org_id + RLS | [DECIDIDO] |
| ADR-009 | `contract.inferred` (exact/**trusted**/heuristic/declared); sin warnings en `catalog` | [DECIDIDO] |
| ADR-010 | YAML config_dir = artefacto derivado (no contrato) | [DECIDIDO] |

---

## 20. Referencias

- `wpipe_os/AGENTS.md` — reglas obligatorias (prevalecen)
- `wpipe_os/PROJECT_MAP.md` — mapa ecosistema
- Golden: `extra_metadata_face`, `embedding` (media path)
- Código: `wpipe/pipe/pipe.py`, `wpipe/util/transform.py`, `wpipe/type_hinting/validators.py`
- Steps: `wpipe-steps/core/base.py`, `steps_catalog.json` (**manifiesto de release**)
- MCP: `wpipe-mcp/src/wpipe_mcp/server.py` (11 tools)