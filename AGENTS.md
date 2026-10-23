# AGENTS.md — wpipe-studio

> Contexto persistente para cualquier agente (humano o IA) que trabaje en este repo.
> **Leer este archivo entero antes de tocar código.** Las decisiones marcadas como
> `[DECIDIDO]` son cerradas: no reabrir sin permiso explícito del owner.

---

## 1. Propósito

`wpipe-studio` es un **SaaS multi-tenant estilo n8n para diseñar pipelines WPipe** y
generar microservicios Python verificados, listos para producción, descargables como ZIP.

El usuario describe qué quiere. El sistema:

1. Propone un plan de trabajo.
2. Genera el microservicio completo (FastAPI + pipeline WPipe + Docker + Makefile + tests).
3. Lo **verifica** ejecutando la batería de calidad en un sandbox Docker.
4. Itera con el agente hasta que todo pasa.
5. Devuelve un ZIP que funciona.

### 1.1 El criterio de éxito es uno solo

> **El ZIP descarga funciona. `app/pipelines.py` corre de punta a punta y pasa la batería.**

No "genera código plausible". No "el agente dijo que está bien". No "compila".
Funciona, o no se descarga. Todo lo demás es secundario.

### 1.2 Nota sobre el nombre (leer antes de "corregir" nada)

Este repo se llama **`wpipe-studio`**. Nació como `wpipe-n8n` y se renombró porque
**n8n ya es un producto trademarkado** y la competencia directa es un problema legal
y de posicionamiento, no técnico.

**El nombre `wpipe-n8n` no debe reintroducirse** — ni en el directorio, ni en el remote
de git, ni en variables, ni en nombres de paquete, ni en textos de UI.

> ✅ **Infraestructura resuelta:** el remote ya apunta a
> `git@github.com:wisrovi/wpipe-studio.git` y el repo está sincronizado. Ver §12.3.

---

## 2. Ecosistema: qué YA existe

`wpipe-studio` **no** es un proyecto aislado. Vive en `wpipe_os/` junto a 5 repos
hermanos. Antes de construir cualquier cosa, hay que saber qué está hecho.

### 2.1 Tabla de repos

| Repo | Versión verificada | Rol para wpipe-studio |
|---|---|---|
| `wpipe` | **2.5.8** | Runtime de pipelines. `Pipeline`, `step`, `to_obj`, decoradores. |
| `wpipe-steps` | **1.0.1** | **196 steps** en release. La biblioteca de bloques del canvas. Su manifiesto `steps_catalog.json` es la **fuente de verdad del catálogo** (§5.6.1). |
| `wpipe-plugins` | — | **1 step** de comunidad. Mismo formato de catálogo. |
| `wpipe-mcp` | **0.4.1** | **11 tools MCP** que wpipe-studio orquesta. Ver §2.2. |
| `wpipe-api` | — | API REST de wpipe. Referencia de estilo, no dependencia directa. |

> Verificado por inspección directa del código. Si una versión cambia, actualizar esta tabla.

### 2.2 `wpipe-mcp`: la pieza más importante y más deuda

`wpipe-mcp` es **el motor de generación y verificación**. `wpipe-studio` es,
esencialmente, un planificador y una UI sobre él.

**11 tools MCP** (`wpipe-mcp/src/wpipe_mcp/server.py`, 1196 líneas):

| Tool | Línea | Qué hace |
|---|---|---|
| `search_wpipe_step` | 103 | Busca en el catálogo de 196 steps |
| `deploy_wpipe_scaffolding` | 120 | Genera el esqueleto del proyecto |
| `validate_wpipe_project` | 197 | Corre la batería de calidad |
| `document_wpipe_project` | 298 | Genera el README del proyecto |
| `refactor_monolith_to_wpipe` | 462 | Convierte script monolítico en pipeline |
| `generate_wpipe_tests` | 669 | Genera tests |
| `validate_context_flow` | 758 | Valida que el contexto fluya entre steps |
| `dry_run_pipeline` | 880 | **Ejecuta el pipeline. La prueba de fuego.** |
| `optimize_wpipe_pipeline` | 978 | Optimiza |
| `get_wpipe_architect_blueprints` | 37 | Blueprints de código |
| `get_wpipe_architect_manual` | 149 | Manual de arquitectura |

**El problema:** 8 de esas 11 tools son **lógica de negocio inline dentro de
`server.py`**. No son funciones puras importables — son código pegado dentro de un
decorador `@mcp.tool()`.

```
server.py   1196 líneas   ← casi toda la lógica inline, no reutilizable
templates.py  357 líneas  ← scaffolding actual, MUCHO más pobre que el ZIP objetivo
catalog.py     97 líneas  ← esto sí es reutilizable
```

`templates.py` genera un proyecto de ~6 archivos. El ZIP objetivo (§5) tiene ~20 y
incluye Dockerfile, Makefile, tests, `.pylintrc`, diagramas mermaid y logging.

> **🔴 `[DECIDIDO]` Prerrequisito bloqueante del Sprint 2:**
> Extraer la lógica inline de `server.py` a módulos puros (`validators.py`,
> `codegen.py`, `testgen.py`, `docgen.py`, `optimizer.py`, `dryrun.py`) y dejar
> `server.py` como un **wrapper MCP delgado** de ~150 líneas que solo registra tools.
> Sin este refactor, cada tool solo puede usarse vía MCP desde un LLM — lo que significa
> **ningún test unitario, ningún uso en backend propio, coste de LLM por validación**.
>
> Este refactor ocurre en el repo hermano `wpipe-mcp`, en su propio ciclo.

---

## 3. Pasado: lo que se decidió y lo que se descartó

Documentar esto evita re-litigar decisiones ya tomadas.

### 3.1 Historia de la idea

El owner (`wisrovi`) es autor tanto de `wpipe` como de los 5 repos hermanos. La
observación de partida: **los pipelines WPipe ya existen y funcionan en producción**
(`matching-faces` tiene servicios reales con métricas). Pero:

- Escribirlos requiere saber mucho de WPipe.
- El scaffold es tedioso y repetitivo (Dockerfile, Makefile, `.pylintrc`, tests...).
- Un LLM genera el código pero **no sabe si funciona** — y no puede comprobarlo.

`wpipe-studio` ataca exactamente esa brecha: **el LLM genera, `wpipe-mcp` verifica.**

### 3.2 Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Self-hosted / on-premise** como modelo principal | El owner eligió explícitamente **SaaS multi-tenant desde el día 1**. Un modelo híbrido (self-hosted primero, cloud después) seconsidered pero **no se eligió**. ⚠️ Riesgo asumido: hosting de código de usuario es caro y arriesgado (ver §6.6). |
| `app/gui.py` generado | El owner lo descartó. **Fuera de alcance.** Ver §5.2. |
| `report.md` generado | El owner lo descartó. **Fuera de alcance.** Ver §5.2. |
| Preview síncrono del parser en el backend | Riesgo de RCE. Ver §5.6 / P5. |

### 3.3 Realidad del mercado (contexto, no decisión)

El canvas n8n-like es commoditizado. Lo defendible es **la verificación**: la capacidad
de decir "este pipeline corre, con estos tests, y aquí están los resultados".
Por eso §1.1 define el éxito como una sola cosa.

---

## 4. Visión, metas y el loop de verificación

### 4.1 Visión

> Un ingeniero de ML dibuja su pipeline en un canvas, y 30 segundos después tiene un
> repositorio completo, con tests, Docker, Makefile y CI, que **ya ha sido ejecutado y
> verificado** — no solo escrito.

### 4.2 Las 4 capacidades (todas prioritarias)

| # | Capacidad | Descripción | Sprint |
|---|---|---|---|
| 1 | **Plan de trabajo** | De la descripción en lenguaje natural a un plan con fases, archivos y riesgos | S1 |
| 2 | **Microservicio completo** | ZIP con Dockerfile, Makefile, tests, docs, CI | S1–S2 |
| 3 | **Canvas visual** | Editor tipo n8n donde cada bloque es un estado | S2–S3 |
| 4 | **Estados nuevos por IA** | El usuario describe un bloque que no existe → se genera | S3 |

### 4.3 El loop de verificación (el corazón del producto)

Este es el loop de Sprint 1. Todo lo demás se apoya en él.

```
descripción del usuario
        │
        ▼
   agente planificador  ──►  plan de trabajo (fases, archivos, riesgos)
        │
        ▼
   agente generador  ──►  escribe el microservicio completo
        │
        ▼
   ┌──────────────────────────────────────────┐
   │  BATERÍA DE CALIDAD (en sandbox Docker)  │
   │                                          │
   │  1. black         → formateo            │
   │  2. isort         → imports             │
   │  3. ruff          → lint rápido         │
   │  4. mypy          → tipado estricto     │
   │  5. pylint        → lint completo       │
   │  6. pytest        → tests, cov ≥ 60%    │
   └──────────────────────────────────────────┘
        │
        ├──► FALLA ──► agente reparador (con el error exacto) ──┐
        │                                                        │
        │  ◄───────────────────────────────────────────────────┘
        │
        ▼
   PASÓ TODO
        │
        ▼
   dry_run_pipeline  ──► ¿ejecuta de verdad?
        │
        ├──► FALLA ──► agente reparador ──┐
        │                                 │
        │  ◄──────────────────────────────┘
        ▼
   ZIP descargable
```

**Puntos no negociables de este loop:**

- **El gate es estricto.** Si `pytest` falla, no hay ZIP. Sin excepciones ni "warnings".
- **Los errores se devuelven al agente verbatim.** "arregla el error" sin el error
  real es garantía de que no se arregle.
- **Iteración con presupuesto.** Máx. N intentos (sugerido: 5) y luego escalar a humano.
- **`dry_run_pipeline` es la prueba final.** Los tests pueden pasar y el pipeline fallar
  en runtime (un `ProcessError`, un modelo que no descarga, un input mal formado).

### 4.4 Métricas de éxito

| Métrica | Objetivo | Por qué importa |
|---|---|---|
| **Tasa de éxito de 1ª generación** | ≥ 40% | La métrica que define el producto |
| **ZIP verificados / generados** | 100% | Inviolable (§1.1) |
| **Tiempo hasta ZIP** | < 5 min (1–3 steps), < 15 min (10+) | Flujo individual |
| **Pasos de iteración promedio** | ≤ 2.5 | Si es > 3, el agente no sabe corregir |
| **Cobertura de tests** | ≥ 60% por defecto | Por debajo no se considera production-ready |

---

## 5. El microservicio objetivo

### 5.1 Estructura del ZIP

```
<microservice>/
├── Dockerfile                    ← python:3.11-slim, usuario no-root, healthcheck
├── docker-compose.yml           ← para dev local, no para producción
├── Makefile                      ← 9 targets (ver §5.3)
├── requirements.txt
├── .dockerignore
├── README.md                     ← generado por document_wpipe_project
└── app/
    ├── main.py                   ← FastAPI + asyncio.Lock + response_model
    ├── pipelines.py              ← ★ EL PUNTO DE SALIDA. Debe funcionar.
    ├── .pylintrc                 ← max-line-length=100, disables justificados
    ├── pipelines.wpipe.mermaid   ← diagrama del pipeline (artefacto derivado)
    ├── configs/
    │   ├── settings.py           ← typed settings
    │   └── *.yaml                ← ⚠️ artefacto derivado, NO contrato (ver §5.4)
    ├── dto/                      ← UN Context POR ESTADO (ver §6.7)
    ├── states/
    │   ├── <un_estado>.py        ← un archivo = un estado
    │   └── error_capture.py      ← siempre presente
    ├── utils/                    ← helpers puros, sin estado
    └── tests/
        ├── __init__.py
        ├── test_pipeline.py      ← el test que DEBERÍA FALLAR si el pipeline está roto
        ├── test_states.py
        ├── test_dto.py
        ├── test_api.py
        └── test_utils.py
```

**Referencias reales verificadas:**

| Servicio | LOC (`app/`, sin dumps) | Tests | Perfil |
|---|---|---|---|
| `extra_metadata_face` | **1827** | `app/tests/` (5 archivos) | Lineal, 6 states |
| `embedding` | **2459** | `tests/` (raíz) | 2 pipelines, loops `For` |

> ⚠️ **Inconsistencia detectada:** `extra_metadata_face` tiene los tests en `app/tests/`;
> `embedding` los tiene en `tests/` (raíz). **Estandarizar en `app/tests/`.**

### 5.2 `[DECIDIDO]` Fuera de alcance — NO se generan

El owner decidió explícitamente que estos archivos **no** se generan:

| Archivo | Antes | Ahora | Razón |
|---|---|---|---|
| `app/gui.py` | generado (109 y 131 LOC) | **FUERA** | Duplica la puerta de entrada; el usuario lo hace a mano si lo quiere |
| `report.md` | generado | **FUERA** | No aporta al usuario lo que no está en el README |
| `app/start.sh` | generado | **FUERA** | Reemplazado por `CMD ["python3", "main.py"]` en el Dockerfile |

**El límite exacto del alcance de generación:**

> El microservicio está completo cuando **`app/pipelines.py` funciona con los pipelines
> definidos**. Nada antes, nada después.

Consecuencia: el ZIP pasa de ~45 a ~20 archivos, y la complejidad de generación baja
~20% (desaparecen `gradio` como dependencia pesada, la doble puerta de entrada y el
benchmark de arranque).

### 5.3 Makefile — los 9 targets

Extraídos de los Makefiles reales de `extra_metadata_face` y `embedding`.
**No inventar otros. No eliminar ninguno.**

| Target | Qué hace |
|---|---|
| `help` | Lista los targets disponibles |
| `install` | `pip install -r requirements.txt` |
| `dev` | Servidor con autoreload |
| `build` | Construye la imagen Docker |
| `up` / `down` | Levanta / baja el compose |
| `logs` | Sigue los logs |
| `test` | Pytest con coverage |
| `lint` | pylint + flake8 |
| `format` | black + isort |

### 5.4 `[DECIDIDO]` El YAML de `config_dir` es artefacto derivado

`Pipeline(..., config_dir="configs")` escribe un YAML en cada ejecución. Ese YAML
**no es un contrato**: es la foto de una ejecución concreta.

**Consecuencia para el generador:** el IR serializa estados como
`"module:ClassName"` y el YAML se deja que WPipe lo escriba. Nunca se parsea el YAML
para reconstruir el pipeline.

> **🔴 Bug real encontrado en `embedding`:**
> ```
> app/configs/Insightface_Embedding_Comparer.yaml:
>   - func: <states.config_pipeline.ConfigPipeline object at 0x7d0e64dd1a80>
> ```
> El serializador escribe el **`repr()` de un objeto**, no el `module:ClassName`.
> Un pipeline con bucles anidados **no se puede reconstruir** desde su propio YAML.
> Esto confirma que el YAML no sirve como contrato.

### 5.5 `[DECIDIDO]` Los 3 bugs que el LLM NO va a inferir solo

Estos tres bugs **existen hoy** en los microservicios de referencia. El agente
generador debe conocerlos o va a repetirlos. Son el motivo de existir de esta sección.

**🔴 Bug 1 — YAML serializa `repr()` de objetos**
Ver §5.4. `func: <states.config_pipeline.ConfigPipeline object at 0x7d0e64dd1a80>`.
El pipeline no es recuperable desde su YAML.

**🔴 Bug 2 — `merge_policy` contradictorio**
```python
# embedding/app/pipelines.py:74 y :83
merge_policy="accumulate",

# embedding/app/configs/Insightface_Embedding_Comparer.yaml:11 y :19
merge_policy: last_wins
```
El código dice `accumulate`; el YAML persistido dice `last_wins`. **Divergen.**
Consecuencia: dentro de un `For`, el resultado del último item **pisa** los anteriores
en lugar de acumularlos. Es el modo de fallo clásico de un pipeline de embeddings.

**🔴 Bug 3 — Estado compartido vs Context por estado**
`extra_metadata_face` tiene `FaceMetadataContext` en
`app/states/base_face_state.py`, importado por **6 estados distintos**, más una función
`ensure_context(context)` que cada estado llama para reconvertir el dict a la clase.

Eso es un Context **global disfrazado**: 6 archivos dependen del mismo objeto, y
`ensure_context` existe solo para cerrar ese agujero. `wpipe-studio` lo hace
**diferente** — ver §6.7.

### 5.6 `[DECIDIDO]` Dialecto de los estados

> **Owner:** *"Asume que `wpipe-steps` ya da estados sólidos y funcionales. Luego miro el
> estado en sí para optimizarlo."*

**Los 196 steps de `wpipe-steps` son la base de confianza del producto. Se consumen tal
cual. `wpipe-studio` no los audita, no los reescribe y no supone que estén mal.**

Ver §5.6.1 para los números exactos y §12.4 para el track de optimización aparte.

#### Dialecto A — `@step` + `@to_obj(Context)` ← lo que **genera** wpipe-studio

```python
@step(
    name="DeepFaceExtractionStep",
    version="1.0.0",
    timeout=15,
    description="Executes DeepFace demographic and emotion analysis.",
    tags=["deepface", "demographics"],
    retry_count=2,
    retry_delay=0.1,
)
class DeepFaceExtractionStep:
    def __init__(self, actions: Optional[List[str]] = None) -> None:
        self.actions = actions or settings.deepface_actions

    @timeout_sync(seconds=12)
    @to_obj(FaceMetadataContext)                 # ← Context class
    def __call__(self, context: Any) -> Any:
        ctx: FaceMetadataContext = ensure_context(context)
        ctx.deepface_raw = analysis_objs[0]        # ← write
        return ctx
```

**Todo derivable por AST:**

| Dato | Fuente |
|---|---|
| `name`, `version`, `timeout`, `description`, `tags`, `retry_count`, `retry_delay` | argumentos de `@step` |
| Campos del Context | la clase en `@to_obj(X)` |
| `writes` | asignaciones `ctx.campo = ...` |
| `reads` | accesos `ctx.campo` |
| Kwargs configurables | `__init__` |

#### Dialecto B — `BaseStep.execute(data: Dict)` ← los 196 de `wpipe-steps`

`wpipe-steps/wpipe_steps/core/base.py:5-49`:

```python
class BaseStep(ABC):
    def execute(self, data: Dict[str, Any]) -> Dict[str, Any]: ...
    def __call__(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self.execute(data)
```

Sin decorador, sin `@to_obj`, firma `Dict` genérica. Es el dialecto **confiado**:
se usa, no se inspecciona deeply.

#### 5.6.1 `[DECIDIDO]` El manifiesto manda: JSON como fuente de verdad

> **Owner:** *"El JSON es la realidad. Por eso algunos estados no están allí porque
> están en desarrollo; por eso el GET/POST para obtener la lista estable."*

`wpipe-steps/steps_catalog.json` es el **manifiesto de release**: la lista curada y
soportada. **Es la única fuente de verdad del catálogo.**

| Regla | Consecuencia |
|---|---|
| El manifiesto es la verdad | `wpipe-studio` **no copia** el JSON a su repo |
| Un step no listado no existe | Lo que está solo en código está **en desarrollo** → **no se ofrece** |
| El manifiesto se regenera al publicar | `pip install -U wpipe-steps` → el siguiente `GET` ya lo trae |
| Actualizar no es parchear | **Cero commits en `wpipe-studio`** para añadir steps |

> 🔴 **Prohibido derivar el catálogo recorriendo el filesystem.** Eso expondría
> trabajo en curso como producto. El AST se usa **solo para enriquecer entries que el
> manifiesto ya declara** (§5.6.2).

**Verificado cruzando las 196 filas contra el árbol de `wpipe_steps/`:**

| Comprobación | Resultado |
|---|---|
| Namespaces en el manifiesto | **193** |
| Namespaces con step en el código | **192** |
| **Steps en código ausentes del manifiesto** | **0** ✅ |
| Manifiesto sin step en código | 1 → `wpipe_steps.utils.read_yaml` (sin `states/`) |

**El manifiesto es exacto.** No hay trabajo en curso filtrándose al catálogo.

```text
database 101 · ai 52 · communication 9 · connectivity 6 · infrastructure 6
security 6 · data 5 · multimedia 5 · system 5 · utils 1        TOTAL 196
```

#### 5.6.2 El AST solo enriquece lo ya publicado

El manifiesto **no publica contrato**: sus 16 claves son descriptivas (`name`,
`func_name`, `namespace`, `version`, `description`, `license`, `repo`, `author`,
`examples`, `environment`, `requirements`, `how_to_use`, `category`,
`subcategory1..3`). **Ninguna es `reads`/`writes`.** Por eso hace falta leer la firma
del código — **pero solo de las entries del manifiesto**:

```python
class CatalogEntry(BaseModel):
    # ── del manifiesto (autoridad) ───────────────────
    cls: str; ns: str; cat: str; version: str
    description: str; requirements: list[str]
    # ── del AST (enriquecimiento, tolerante a fallo) ─
    module: str | None
    params: list[ParamSpec]      # de __init__ → alimenta el panel del canvas
    response_key: str | None     # default literal
    index_ok: bool = True
```

**Reglas del enriquecimiento:**

- Se parsea el **`namespace` del manifiesto**. Nunca se recorre el árbol.
- Si un entry no parsea → `index_ok=False` + warning. **No se oculta ni se bloquea.**
- La identidad es `(namespace, func_name)`, **nunca el nombre de clase solo**: hay
  nombres repetidos entre variantes async/sync (Redis).
- `func_name` puede no coincidir con la clase actual (`GraphQLContext` en JSON vs
  `GraphQLQueryStep` en código) → se resuelve por namespace + coincidencia
  normalizada y **se reporta el drift** al owner de `wpipe-steps`.

**Y de ahí sale el panel de config del canvas, sin LLM:**

```python
NmapScanStep        : target, ports, arguments, response_key, name, version
ShodanSearchStep    : api_key, query, search_type, response_key, name, version
VaultSecretsStep    : vault_url, secret_path, token, mount_point, response_key, ...
HashGeneratorStep   : algorithm, input_key, file_path, response_key, name, version
```

`response_key` es la write real, con default literal:

```
NmapScanStep      -> 'nmap_scan'        WafFilterStep    -> 'waf_status'
ShodanSearchStep  -> 'shodan_results'   Fail2BanCheckStep-> 'fail2ban_status'
HashGeneratorStep -> 'hash_result'      VaultSecretsStep -> 'vault_secrets'
```

> **✅ Ganancia grande:** los 196 steps son **configurables estáticamente**. No hace
> falta un LLM que adivine los parámetros.

**Cache:** por `sha256(steps_catalog.json)`, no por el árbol de fuentes. `POST
/catalog/refresh` **solo invalida caché** — nunca amplía la lista.

**Fail-safe:** manifiesto ilegible → **error explícito**, nunca catálogo vacío. Un
catálogo vacío silencioso es peor que un 500.

#### 5.6.3 Dos incidencias conocidas en `wpipe-steps` (no son asunto de este repo)

**a) Manifiesto sin implementación** — `wpipe_steps.utils.read_yaml` está en el JSON
pero no tiene `states/`. El GET lo devuelve (el manifiesto manda) con panel de config
vacío. Se reporta al owner; **sin workaround aquí**.

**b) Código muerto** — `wpipe_steps/ai/text/classification/states/classification.py:76`
tiene `return data`, y **las líneas 78–114 son inalcanzables**.

Ambas **NO bloquean `wpipe-studio` y no se arreglan aquí.** Van al track de
optimización de estados (§12.4).

### 5.7 `[DECIDIDO]` Los 3 orígenes de un bloque del canvas

> **Owner:** *"El color depende del origen: uno si viene de pip, otro si lo aporta el
> usuario, otro si está descrito y hay que generarlo con IA."*

| `StepOrigin` | Significado | Color | Cómo llega |
|---|---|---|---|
| **`catalog`** | Ya existe, instalable por pip | **Verde** | `wpipe-steps` / `wpipe-plugins` vía `search_wpipe_step` |
| **`user_imported`** | El usuario aporta un `.py` propio | **Azul** | Upload de archivo (ver §5.8) |
| **`described`** | El usuario lo describe, no existe | **Ámbar** | LLM lo genera |

**Invariantes:**

- El color es **derivado** de `origin`. Nunca se guarda por separado.
- `origin` es un **enum de 3 valores**, no un booleano. Alimenta color, icono y badge.
- Un bloque `described` que el LLM ya generó **cambia a `user_imported`**
  (o a `catalog` si coincidió con uno existente). El canvas debe reflejarlo.
- Un bloque con `origin=described` **no se puede descargar**. Solo se descarga después
  de generarse y verificarse. Es visible pero bloqueado, con su razón.

### 5.8 `[DECIDIDO]` P4 — `user_imported` = subir un archivo `.py`

> **Owner:** *"P4 opción (a)"* — el usuario **sube un archivo `.py`** con un step
> existente; wpipe-studio lo parsea, extrae su contrato y lo pinta de azul.

Flujo:

```
usuario sube step.py
        │
        ▼
   parseo AST  ──►  ¿Dialecto A o B?  (§5.6)
        │
        ├── A ──► contrato EXACTO:  reads/writes del @to_obj + cuerpo
        │
        └── B ──► contrato HEURÍSTICO: escaneo de data[...] / data.get(...)
                    ⚠️ escribe indirectos NO detectables
        │
        ▼
   el bloque aparece en el canvas, origin=user_imported, azul
```

**El parser NO ejecuta el código del usuario. Solo lo parsea con `ast`.**
Aun así, un `.py` subido es entrada no confiable → se procesa en el sandbox (§5.9).

### 5.9 `[DECIDIDO]` P5 — el parser corre en el sandbox

> **Owner:** *"P5, sí."* → **(a) en el sandbox. Confirmado y cerrado.**

| Opción | Descripción | Veredicto |
|---|---|---|
| **(a) En el sandbox Docker** ✅ | El sandbox que ya hay que construir (§6.6) | **`[DECIDIDO]` confirmado** |
| (b) Worker con restricciones | Proceso con `resource.setrlimit`, sin red | Rechazado: servicio extra que mantener |
| (c) WebAssembly en el browser | `ast` en WASM | Rechazado: coste irreal |

**Consecuencia aceptada:** no hay preview síncrono del bloque recién subido. El
canvas muestra el bloque con su contrato (ya parseado) aunque la *ejecución* no se
pueda previsualizar hasta que el sandbox esté disponible.

**Por qué (a) y no (b):** el parser ejecuta AST sobre código del usuario. En el
backend FastAPI eso es **RCE**. Un sandbox mal hecho te duele el día que se pone
público. Y como el sandbox es la base de todo (§6.6), no es trabajo extra.

---

## 6. Diseño técnico

### 6.1 Arquitectura del SaaS

```
┌──────────────────────────────────────────────────────────┐
│  Frontend — React 19 + @xyflow/react (canvas)            │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │  Canvas  │ │ Inspector│ │ Generador │ │  ZIP / Run │  │
│  └──────────┘ └──────────┘ └───────────┘ └────────────┘  │
└────────────────────────────┬─────────────────────────────┘
                             │ REST + WS (streaming del agente)
┌────────────────────────────▼─────────────────────────────┐
│  Backend — FastAPI                                          │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌────────────────┐  │
│  │  Auth   │ │  IR      │ │ Agente │ │  Step parser   │  │
│  │ (Clerk) │ │ (Pydantic│ │ LLM    │ │  (AST, sandbox)│  │
│  │         │ │  3 niv.) │ │ tool-  │ │                │  │
│  └─────────┘ └──────────┘ │  use   │ └────────────────┘  │
│                           │  +MCP  │                      │
│  Postgres (async/SQLAlchemy)   │  Redis + Celery        │
│  multi-tenant: org_id en     │  cola de jobs de        │
│  TODAS las tablas + RLS      │  generación             │
└───────────────────────────────┴─────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│  Sandbox — Docker efímero POR EJECUCIÓN                   │
│  batería de calidad + dry_run + zip                       │
└──────────────────────────────────────────────────────────┘
```

### 6.2 El IR: 3 niveles, y por qué

El IR es la **única fuente de verdad**. Si el canvas, el agente y el generador
discrepan, hay un bug.

| Nivel | Nombre | Qué es | Quién lo consume |
|---|---|---|---|
| 1 | **CanvasIR** | El grafo visual: nodos, posiciones, aristas | El canvas (React) |
| 2 | **SemanticIR** | Tipos, contratos, config, orígenes | El agente, el validador |
| 3 | **TargetIR** | El proyecto concreto a generar | El generador de código |

**Flujo:** `CanvasIR --enriquecer--> SemanticIR --resolver--> TargetIR --emitir--> ZIP`

> Por qué 3 y no 1: los metadatos de posición del canvas **no** deben filtrarse al
> generador de código. Y el agente necesita un nivel semántico que el canvas no tiene.

### 6.3 `[DECIDIDO]` Tipos de nodo

```python
NodeKind = Literal["step", "condition", "for", "parallel"]
```

| Tipo | Qué representa | Campos propios |
|---|---|---|
| `step` | Un estado WPipe | `module`, `class_name`, `kwargs`, `decorator` |
| `condition` | Bifurcación | `expression`, `branches: {true, false}` |
| `for` | Loop | `expression`, `iterations`, `merge_policy`, `body: list[Node]` |
| `parallel` | Ejecución concurrente | `branches: list[list[Node]]` |

**`merge_policy` es un campo de primera clase, no un detalle interno.** Es la causa
del Bug 2 (§5.5) y de un modo de fallo silencioso muy caro. El IR debe hacerlo
explícito, visible en el canvas y validado.

### 6.4 El schema de un `StepNode`

Cada estado necesita **todo** esto para poder generar código verificable:

```python
class StepNode(BaseModel):
    # ── identidad ─────────────────────────────────────
    id: str
    name: str                       # "DeepFaceExtractionStep"
    module: str                     # "app.states.deepface_extraction_step"
    class_name: str                 # "DeepFaceExtractionStep"

    # ── origen (§5.7) ────────────────────────────────
    origin: StepOrigin              # catalog | user_imported | described

    # ── contrato de datos (§5.6) ─────────────────────
    contract: ContextContract

    # ── construcción ─────────────────────────────────
    kwargs: dict[str, Any]          # {"actions": ["age", "gender"]}

    # ── metadatos del decorador @step ────────────────
    step_meta: StepMeta
    #   name, version, timeout, description, tags,
    #   retry_count, retry_delay

    # ── posición en el canvas (nivel 1, no se codifica) ─
    position: Position | None
```

**Lo que un LLM NO puede inferir solo y por eso debe estar explícito:**

1. **La clase base** — ¿`BaseStep` (Dialecto B) o clase con `@step` (Dialecto A)?
2. **Los `kwargs` de construcción** — qué se pasa a `__init__` en `set_steps`.
3. **Los parámetros del decorador** — `timeout`, `retry_count`, `description`… no son
   argumentos de `__init__`; viven en `@step`.
4. **El contrato de Context** — qué campos lee y escribe (§6.7).
5. **`merge_policy`** en bucles (§6.3).

### 6.5 `ContextContract` y su honestidad

Dado que el contrato **no siempre es derivable** (§5.6), el modelo debe declarar
en qué confianza se obtuvo la información:

```python
class ContextContract(BaseModel):
    reads:  set[str]
    writes: set[str]

    # ← CAMPO DE HONESTIDAD. Sin esto, el sistema miente sobre lo que sabe.
    inferred: Literal["exact", "heuristic", "declared"]

    #   "exact"     → Dialecto A (@to_obj) o declarado por el autor. Confiable.
    #   "trusted"   → origin=catalog, Dialecto B del manifiesto. OPAQUE por diseño (§5.6).
    #   "heuristic" → .py subido del usuario, Dialecto B. Escaneo de data[...].
    #   "declared"  → el usuario lo rellenó a mano.
```

**Regla del validador del IR, según el origen:**

| `origin` | Qué hace el validador |
|---|---|
| `catalog` | **Confía.** No audita, no avisa. El manifiesto ya es la release curada. |
| `user_imported` + `heuristic` | **Avanza con warning visible**, no falla en silencio |
| `described` | Valida normal (contrato recién generado, aún no verificado) |

> **Por qué `catalog` no genera ruido:** los steps de `wpipe-steps` son la base
> confiable del producto y el owner los considera sólidos. Avisar del 95% del
> canvas solo entrena al usuario a ignorar warnings. El campo `inferred` se usa
> para el código **no confiable del usuario** — que sí puede estar mal — y para
> dejar el cableado verificado en runtime dentro del sandbox (§6.6).

### 6.6 Seguridad del sandbox — `🔴 NO NEGOCIABLE`

`wpipe-studio` es **SaaS multi-tenant desde el día 1**: los usuarios suben código y lo
ejecutan. Eso es un hosting de código arbitrario. Los controles mínimos:

| Control | Requisito |
|---|---|
| **Aislamiento** | Un contenedor efímero **por ejecución**. Nunca reutilizar. |
| **Privilegios** | Sin `--privileged`. Sin socket Docker del host. |
| **Red** | Bloqueada por defecto; allowlist explícita para descargas de modelos. |
| **CPU** | `--cpus` limitado |
| **RAM** | `--memory` limitado + `--memory-swap` igual a RAM (sin swap) |
| **PID** | `--pids-limit` (anti fork-bomb) |
| **Disco** | tmpfs con quota, o volume con límite |
| **Tiempo** | Timeout duro + `TaskTimer` interno (patrón `extra_metadata_face`) |
| **Tenancy** | `org_id` en **todas** las tablas + RLS de Postgres |
| **Limpieza** | Destruir el contenedor pase lo que pase (`finally`) |
| **Secretos** | Nunca montar credenciales del host. Tokens de pago via variable de entorno efímera. |

**El parser (§5.8) y la batería de calidad (§4.3) corren aquí. No en el backend.**

### 6.7 `[DECIDIDO]` Context: uno por estado, en `dto/`

> **Owner:** *"El context es uno por estado, alojado en `dto/`, los estados en
> `states/`, y cada archivo cumple SRP — una responsabilidad."*

**Adoptado. Es además el patrón de `wpipe-steps` (`dto/` + `states/` + `BaseStep`).**

```
app/
├── dto/                    ← UN Context por estado
│   ├── image_validation_context.py
│   ├── deepface_extraction_context.py
│   └── ...
└── states/                 ← UN estado por archivo
    ├── image_validation_step.py
    ├── deepface_extraction_step.py
    └── error_capture.py
```

**Lo que esto elimina:**

- ❌ `app/states/base_face_state.py` con un Context global
- ❌ `ensure_context(context)` — la función que existía solo para tapar ese agujero
- ❌ la dependencia de 6 archivos sobre un mismo objeto compartido

**Cada estado declara exactamente qué necesita.** Eso es SRP aplicada al dato, no
solo al comportamiento.

#### ⚠️ Lo que el Context por estado SÍ y lo que NO detecta

> **Owner:** *"Dialecto A para los estados nuevos."* — Verificado y **correcto**.

El layout es viable. Pero hay una consecuencia que hay que documentar, porque si
alguien asume lo contrario se lleva una sorpresa en producción.

Leído en `wpipe/wpipe/util/transform.py:153-190` (`to_obj`) y
`wpipe/wpipe/type_hinting/validators.py:73-135` (`TypeValidator.validate`):

```python
# transform.py:182-187 — el dict pasa por el schema, LUEGO se convierte a SNS
TypeValidator.validate(data_arg, schema)     # ← sobre el dict ACUMULADO completo
new_args[data_idx] = dict_to_sns(data_arg)  # ← se entrega SimpleNamespace, NO el modelo

# validators.py:120-129 — model_validate sobre el dict completo
return expected_type.model_validate(value)
```

Tres consecuencias:

| | |
|---|---|
| ✅ **A favor** | Layout exactamente el de `wpipe-steps`. SRP por archivo. Sin context global. **Coincido.** |
| ⚠️ **En contra** | `to_obj` entrega un **`SimpleNamespace`**, no el modelo tipado. El tipado se valida y luego **se descarta**. |
| 🔴 **Crítico** | `TypeValidator` valida contra el **dict acumulado completo**, y Pydantic por defecto **ignora campos extra**. Un Context por estado valida sus propios campos y **silenciosamente no mira el resto**. |

**Consecuencia de diseño:**

> El Context por estado aporta **SRP y claridad**, pero **NO aporta detección de un
> DAG mal cableado**. Un campo mal escrito o ausente se detecta **en runtime**, dentro
> del sandbox.

**Por qué está bien igual:** la detección vive en el **validador estático del IR**
(§6.2 nivel 2, §6.5), que es donde debe estar — valida antes de generar. Los tipos
generados son documentación y tipado para el usuario, no el mecanismo de validación.

**Pero hay que decirlo en voz alta en el doc**, porque la intuición va al revés: un
arquitecto ve `context: MiContext` y asume que Python está comprobando el cableado.
No lo está.

---

## 7. Reglas del repositorio

1. **El IR es la única fuente de verdad.** Si el canvas y el generador discrepan,
   el generador usa el IR. Nunca al revés.
2. **El gate de calidad es estricto.** Cero excepciones, cero warnings permitidos.
   `pytest` debe pasar para que haya ZIP.
3. **Todo código de usuario se ejecuta solo en el sandbox.** Nunca en el backend.
   Ver §6.6.
4. **Nada hardcodeado.** Rutas de modelos, imágenes o datos se parametrizan.
5. **El `origin` es un enum de 3 valores** y el color se deriva de él. Ver §5.7.
6. **Un Context por estado en `dto/`.** Nada de context global en `states/`. Ver §6.7.
7. **`app/gui.py` y `report.md` no se generan.** Ver §5.2.
8. **El YAML de `config_dir` es artefacto derivado.** Nunca es contrato. Ver §5.4.
9. **El parser nunca ejecuta el código subido.** Solo `ast`. Y en el sandbox. Ver §5.8.
10. **Un dialecto por step.** Dialecto A para lo generado; Dialecto B se consume, no se
    genera. Ver §5.6.
11. **`merge_policy` es explícito en el IR y visible en el canvas.** Ver §6.3.

---

## 8. Estado de las decisiones

| # | Pregunta | Decisión | Quién |
|---|---|---|---|
| **P1** | ¿Qué es un bloque del canvas y cómo se colorea? | 3 orígenes, 3 colores. Ver §5.7 | Owner |
| **P2** | ¿`gui.py` y `report.md`? | **Ambos fuera.** Alcance termina en `pipelines.py`. Ver §5.2 | Owner |
| **P3** | ¿Dónde vive el Context? | Uno por estado, en `dto/`. Ver §6.7 | Owner |
| **P4** | ¿Cómo llega un bloque `user_imported`? | Upload de `.py`. Ver §5.8 | Owner |
| **P5** | ¿Dónde corre el parser? | **(a) sandbox**. Ver §5.9 | Owner — **cerrado** |
| — | ¿Dialecto de los estados generados? | **Dialecto A.** Ver §5.6 | Owner |

**Veredicto sobre las alternativas que el owner consideró y no eligió:**
self-hosted/híbrido (§3.2). Registrado para no re-litigar.

---

## 9. Hoja de ruta

### Sprint 0 — Cimientos (1 semana)
- [x] Remote de git actualizado a `wpipe-studio` y repo sincronizado (§12.3)
- [ ] Scaffold del monorepo: `backend/`, `frontend/`, `sandbox/`
- [ ] Auth con Clerk, modelo multi-tenant (`org_id` + RLS)
- [ ] Spec del IR en Pydantic, nivel 2 (`SemanticIR`)
- [ ] Validación del IR: grafo acíclico, campos alcanzables, `merge_policy` presente

### Sprint 1 — El loop de verificación (2 semanas) ← **el núcleo**
- [ ] **Refactor de `wpipe-mcp`** (§2.2) — **bloqueante**
- [ ] Sandbox Docker con todos los controles de §6.6
- [ ] Agente generador vía tool-use sobre MCP
- [ ] Agente reparador con errores verbatim
- [ ] `dry_run_pipeline` + empaquetado del ZIP
- [ ] **Métrica a mirar: pasos de iteración promedio** (§4.4)

### Sprint 2 — El canvas (2 semanas)
- [ ] React 19 + `@xyflow/react`
- [ ] Paleta de 3 colores por `origin` (§5.7)
- [ ] `CanvasIR` ↔ `SemanticIR`
- [ ] Integración con el agente (streaming de progreso)

### Sprint 3 — Estados nuevos por IA (2 semanas)
- [ ] Parser AST de steps subidos (§5.8), en el sandbox
- [ ] Detección de dialecto A vs B
- [ ] `ContextContract` con campo `inferred` (§6.5)
- [ ] Generación de estados Dialecto A desde descripción
- [ ] Catalog Service: manifiesto + enrich (§5.6) + endpoints `/catalog/*`
- [ ] Resolver drift `func_name` manifiesto↔código y reportarlo al owner

### Stretch
- [ ] Cache de resultados de validación por hash del IR
- [ ] Exportar el IR a diagramas mermaid editables
- [ ] Versionado del IR y migración entre versiones

---

## 10. Anti-patrones

| ❌ No hagas | ✅ Haz esto |
|---|---|
| Preview del parser en el backend | Parser en el sandbox (§5.9) |
| Un Context global en `states/base_*` | Un Context por estado en `dto/` (§6.7) |
| Generar `gui.py` o `report.md` | Alcance = `pipelines.py` (§5.2) |
| Parsear el YAML para reconstruir el pipeline | Serializar `module:ClassName` desde el IR (§5.4) |
| Confiar en `contract` sin mirar `inferred` | Validar el nivel de confianza (§6.5) |
| Derivar el catálogo recorriendo el filesystem | Leer el manifiesto (§5.6.1) |
| Copiar `steps_catalog.json` al repo | Consultarlo por GET + cache por hash |
| Tratar un step ausente del manifiesto como error | Está en desarrollo: **no se ofrece** |
| Devolver catálogo vacío si el manifiesto falla | Error explícito (§5.6.2) |
| `await` en un constructor de `Pipeline` | `@timeout_sync` + `asyncio.Lock` en `main.py` (§5.1) |
| Persistir el resultado crudo del agente sin verificar | Gate estricto antes del ZIP (§1.1) |
| Asumir que `to_obj` valida el cableado del DAG | El validador del IR lo hace (§6.7) |
| Reinventar la convención de steps | Seguir Dialecto A (§5.6) |

---

## 11. Referencias

### 11.1 Microservicios de referencia (los "golden examples")

```
/media/william.rodriguez/4dd20e66-481b-4774-90e5-bcb611aed8f717/
  PROYECTOS_AREA/eyescloud3d/matching-faces/pipelines/apis/
    ├── extra_metadata_face/    ← lineal, 6 states, 1827 LOC, tests en app/tests/
    └── embedding/              ← 2 pipelines, loops For, 2459 LOC, tests en tests/
```

**Son la referencia de estructura y estilo. No son flawless** — tienen los 3 bugs de
§5.5. Un agente que los copie literalmente hereda los bugs.

### 11.2 Repos hermanos

| Ruta | Qué mirar |
|---|---|
| `wpipe/wpipe/pipe/pipe.py` | `Pipeline.set_steps` (:646), `.run` (:64), `.add_error_capture` (:383) |
| `wpipe/wpipe/util/transform.py` | `to_obj` (:153), `dict_to_sns` (:19) — ver §6.7 |
| `wpipe/wpipe/type_hinting/validators.py` | `TypeValidator.validate` (:73) — ver §6.7 |
| `wpipe-steps/wpipe_steps/core/base.py` | `BaseStep` (:5) — Dialecto B |
| `wpipe-steps/steps_catalog.json` | **Manifiesto de release**: los 196 steps (§5.6.1) |
| `wpipe-steps/wpipe_steps/ai/text/classification/states/classification.py` | Código muerto tras `:76` (§5.6) |
| `wpipe-mcp/src/wpipe_mcp/server.py` | Las 11 tools (§2.2) |
| `wpipe-mcp/src/wpipe_mcp/templates.py` | Scaffolding actual (§2.2) |
| `wpipe-mcp/src/wpipe_mcp/catalog.py` | Acceso reutilizable al catálogo |

### 11.3 Documentos del ecosistema

- `wpipe_os/PROJECT_MAP.md` — arquitectura del monorepo. **Leer primero.**
- `wpipe_os/AGENTS.md` — reglas obligatorias del monorepo. **Prevalecen sobre este archivo.**

### 11.4 Referencias externas

- `@xyflow/react` — <https://reactflow.dev>
- Claude tool-use — <https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview>
- FastAPI — <https://fastapi.tiangolo.com>
- Docker resource limits — <https://docs.docker.com/engine/containers/resource_constraints/>

---

## 12. Pendientes

### 12.1 Estructura del repo (sin crear todavía)

Este repo tiene un solo commit inicial (`.gitignore`, `LICENSE`, `README.md`).
**No se crea estructura hasta que haya código.** Tu regla del monorepo
(`AGENTS.md` §2) exige que `PROJECT_MAP.md` refleje estructura **real**, no planes.
Se actualiza el mapa en el mismo commit en que se cree el scaffold.

### 12.2 P5 — cerrado ✅

> **Owner:** *"P5, sí."* → **(a) sandbox. Confirmado.**

§5.9 ya no dice "por defecto, sin confirmar". No hace falta el worker con
`resource.setrlimit`. **Sin pendientes aquí.**

### 12.3 Remote de git — resuelto ✅

```
$ git remote -v
origin  git@github.com:wisrovi/wpipe-studio.git (fetch)
origin  git@github.com:wisrovi/wpipe-studio.git (push)
```

El repo ya estaba renombrado en GitHub (`wisrovi/wpipe-studio`, público) y tenía un
commit `e92e2cc` que local no tenía. Se hizo `git remote set-url` + fast-forward a
`origin/main`. La rama local está **al día con el remote**.

---

## Changelog de decisiones

| Fecha | Cambio | Autor |
|---|---|---|
| 2026-10-01 | Repo creado como `wpipe-n8n` | — |
| 2026-10-01 | Renombrado a `wpipe-studio` (n8n = marca registrada) | Owner |
| 2026-10-01 | P1: 3 orígenes de bloque, 3 colores | Owner |
| 2026-10-01 | P2: `gui.py` y `report.md` fuera de alcance | Owner |
| 2026-10-01 | P3: Context por estado en `dto/` | Owner |
| 2026-10-01 | P4: `user_imported` = upload de `.py` | Owner |
| 2026-10-01 | Estados generados en Dialecto A | Owner |
| 2026-10-01 | **P5 confirmado**: parser `.py` en sandbox. §5.9 | Owner |
| 2026-10-01 | Remote → `git@github.com:wisrovi/wpipe-studio.git` + sync con `origin/main` | Owner |
| 2026-10-01 | **Catálogo: `steps_catalog.json` es el manifiesto de release** (fuente de verdad). No copiar, no derivar del árbol; GET/POST para la lista estable | Owner |
