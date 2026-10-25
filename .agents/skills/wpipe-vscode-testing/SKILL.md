---
name: wpipe-vscode-testing
description: Procedimiento operativo estándar y metodología rigurosa para probar la extensión WPipe Studio en VS Code Web mediante los 3 contenedores Docker y MCP Chrome DevTools.
---

# Procedimiento de Pruebas de WPipe Studio (VS Code Extension & Tri-Instance Docker)

Este documento detalla el procedimiento estandarizado para probar de forma integral y repetible la extensión `wpipe-vscode` en vivo, sin necesidad de consultar nuevamente las directivas.

---

## 1. Topología del Entorno de Pruebas

El entorno de pruebas de la extensión de VS Code se apoya en 3 instancias simultáneas de `code-server` corriendo en contenedores Docker y mapeadas contra el workspace del microservicio generado (`/home/wisrovi/Downloads/ksñldfg/app` montado en `/home/coder/workspace`):

| Instancia | Puerto Local | Contenedor Docker | Rol en Pruebas |
|---|---|---|---|
| **Página 1 (Instancia 1)** | `http://localhost:8080/?folder=/home/coder/workspace` | `ksldfg-code-server-1` | **Canvas Visual Blockly (`pipeline.wpipe`)**: Comprobación del layout de bloques, conexiones en serie/paralelo, badges de licencia (`Blocks X / ∞ · PRO`), paleta de herramientas y consola sin errores de CSP. |
| **Página 2 (Instancia 2)** | `http://localhost:8081/?folder=/home/coder/workspace` | `ksldfg-code-server2-1` | **Explorador y Árbol de Estados (`app/states/`)**: Inspección del registro de estados, archivos `.py` sincronizados, creación vía Wizard y árbol lateral de pasos. |
| **Página 3 (Instancia 3)** | `http://localhost:8082/?folder=/home/coder/workspace` | `ksldfg-code-server3-1` | **Editor de Código Python (`app/pipelines.py`)**: Validación del código descompilado/compilado, ejecución con `execute_pipeline(payload)`, decoradores `@step` y `@to_obj`. |

---

## 2. Ciclo Completo de Compilación y Despliegue en Caliente

Antes de verificar en los navegadores, siempre que se modifique código en `vscode-extension/`:

### Paso 2.1: Compilar TypeScript
```bash
npm --prefix vscode-extension/extension run compile
```

### Paso 2.2: Empaquetar el VSIX
```bash
cd vscode-extension/extension
vsce package --no-git-tag-version --allow-missing-repository -o wpipe-vscode-2.0.0.vsix
cd ../..
```

### Paso 2.3: Desplegar forzadamente en las 3 instancias de Docker
```bash
VSIX="vscode-extension/extension/wpipe-vscode-2.0.0.vsix"
for C in ksldfg-code-server-1 ksldfg-code-server2-1 ksldfg-code-server3-1; do
    docker cp "$VSIX" "$C":/tmp/
    docker exec "$C" code-server --install-extension /tmp/wpipe-vscode-2.0.0.vsix --force
done
```

---

## 3. Protocolo de Pruebas con Chrome MCP (`chrome-devtools`)

Para interactuar y auditar las 3 páginas web con las tools lazy de MCP:

### 3.1 Listar las Páginas Activas
```json
call_mcp_tool:
  ServerName: "chrome-devtools"
  ToolName: "list_pages"
  Arguments: {}
```
Verifica que las páginas 1, 2 y 3 corresponden a los puertos 8080, 8081 y 8082.

### 3.2 Seleccionar y Recargar Páginas
Para forzar que el cliente Webview cargue el nuevo VSIX:
```json
call_mcp_tool:
  ServerName: "chrome-devtools"
  ToolName: "evaluate_script"
  Arguments:
    pageId: 1
    function: "() => window.location.reload()"
```
*(Repetir con `pageId: 2` y `pageId: 3`)*

### 3.3 Auditoría de Consola (Cero Violaciones CSP)
```json
call_mcp_tool:
  ServerName: "chrome-devtools"
  ToolName: "list_console_messages"
  Arguments:
    pageId: 1
```
**Criterio de Aceptación:**
- Cero errores bloqueantes de Content Security Policy (`font-src`, `connect-src`, `script-src`).
- Cero excepciones de scripts no capturados o cargas de recursos 404.

### 3.4 Captura de Pantalla para Evidencia Visual
```json
call_mcp_tool:
  ServerName: "chrome-devtools"
  ToolName: "take_screenshot"
  Arguments:
    pageId: 1
```
**Qué inspeccionar visualmente en la imagen generada:**
1. Los bloques de Blockly se renderizan nítidamente con sus conexiones encadenadas (`CleanDataStep` $\rightarrow$ `TransformPayloadStep` $\rightarrow$ `AISentimentStep` $\rightarrow$ ...).
2. El trigger `wpipe_trigger` y la respuesta `wpipe_response` están correctamente anclados en los extremos.
3. El footer del Canvas muestra el contador dinámico exacto de bloques (p. ej. `Blocks 7 / ∞ · PRO`).

---

## 4. Sincronización Bidireccional: Cómo y Qué Probar

El valor diferencial de WPipe Studio es que la edición de código sincroniza el canvas, y la edición del canvas sincroniza el código.

### 4.1 Prueba Código $\rightarrow$ Canvas
1. En `/home/wisrovi/Downloads/ksñldfg/app/app/pipelines.py`, añade un nuevo estado a la lista de `set_steps([...])` (por ejemplo `QualityCheckStep()`).
2. Actualiza la marca de tiempo del archivo para notificar al inotify watcher dentro de los contenedores Docker:
   ```bash
   touch /home/wisrovi/Downloads/ksñldfg/app/app/pipelines.py
   ```
3. Toma una captura con `take_screenshot` en la Página 1 (`:8080`).
4. **Verificación:** El nuevo bloque debe aparecer automáticamente en el Canvas visual sin requerir recargar la página.

### 4.2 Prueba Wizard $\rightarrow$ Workspace $\rightarrow$ Editor
1. Ejecuta el wizard o genera un estado personalizado en `app/states/<nuevo_estado>.py`.
2. Verifica que el archivo respete el Dialecto A:
   - Decorador `@step(name="...", version="1.0.0")`
   - `@to_obj(ContextDTO)` y `@timeout_sync(seconds=...)`
   - Método `__call__(self, context: Any) -> Any`
3. En la Página 2 (`:8081`), comprueba que aparezca en el árbol de pasos.
4. En la Página 3 (`:8082`), comprueba que el editor refleje el código Python sin advertencias de diagnóstico.

---

## 5. Batería de Pruebas Automatizadas de Calidad (Obligatorias)

Ningún cambio se considera terminado si no pasan todas las siguientes suites:

### 5.1 Daemon OS Suite (51 Pruebas)
```bash
pytest vscode-extension/daemon_os/tests/ -v
```
*(Verifica compilador AST, fusión inteligente de código, límites de plan Free/Pro y criptografía Ed25519)*

### 5.2 Admin Cloudfire Suite (12 Pruebas)
```bash
PYTHONPATH=/home/wisrovi/Documents/w_libraries/wpipe_os/wpipe/editors/extension_example/.venv/lib/python3.12/site-packages:vscode-extension/admin-cloudfire pytest vscode-extension/admin-cloudfire/tests/ -v
```

### 5.3 Microservicio Generado (11 Pruebas)
```bash
PYTHONPATH=/home/wisrovi/Documents/w_libraries/wpipe_os/wpipe/editors/extension_example/.venv/lib/python3.12/site-packages:/home/wisrovi/Downloads/ksñldfg/app/app pytest /home/wisrovi/Downloads/ksñldfg/app/app/test/ /home/wisrovi/Downloads/ksñldfg/app/tests/ -v
```
**Garantiza:**
- `app/test/test_api.py` (Endpoints FastAPI /run y /health)
- `app/test/test_pipeline.py` (`build_pipeline` y `execute_pipeline`)
- `app/test/test_dto.py` (Pydantic ContextDTO)
- `app/test/test_states.py` (Mutaciones reales de contexto)
