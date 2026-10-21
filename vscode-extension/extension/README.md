# WPipe Studio — Extensión Oficial para VS Code

Diseña pipelines de datos visuales mediante bloques ensamblables al estilo Scratux/Scratch y compílalos directamente en microservicios Python limpios, tipados y listos para producción dentro de **Visual Studio Code**.

> **Autor**: William Rodriguez (AI Leader & Solutions Architect — [wisrovi.dev](https://wisrovi.dev))  
> **Ecosistema**: WPipe OS / wisrovi SUITE  
> **Coste de Servidor**: **0 €** (Ejecución 100% local en tu propio ordenador).

---

## Tecnologías y Librerías Relevantes

| Tecnología | Rol en la Extensión |
|---|---|
| **VS Code Extensibility API** | Registro de Custom Text Editors (`*.wpipe`), vistas en la Activity Bar, comandos y Status Bar Items. |
| **Google Blockly & SVG Engine** | Motor gráfico interactivo de bloques con conectores puzzle, zoom, paneo y herramientas visuales. |
| **TypeScript 5** | Tipado estricto y comunicación IPC asíncrona no bloqueante. |
| **VS Code Webview API** | Renderizado del lienzo interactivo con aislamiento y seguridad CSP. |
| **Unix Domain Sockets & HTTP** | Canal IPC de ultra-baja latencia para comunicarse con el daemon `wpipe-engine`. |
| **Cloudflare Workers & D1** | Pasarela de licencias serverless integrada en `api.wisrovi.dev`. |

---

## Características Principales

1. **Diseño Visual de Pipelines (`*.wpipe`)**:
   - Haz clic en cualquier archivo `.wpipe` o usa el comando `WPipe: Crear Nuevo Pipeline Visual`.
   - Ensambla pasos conectando piezas de puzzle visuales: Triggers REST, HTTP Requests, MySQL, Filtros de Seguridad y Bloques de Control.
2. **Compilación Directa a Python**:
   - Un clic en **Compilar a Python** genera la arquitectura completa en tu espacio de trabajo: `app/pipelines.py`, `app/main.py`, `Dockerfile`, `Makefile` y suite de pruebas `tests/test_pipeline.py`.
3. **Smart AST Code Merge**:
   - Preserva automáticamente tu código manual escrito dentro de los bloques `# >>> [WPIPE:CUSTOM_IMPORTS]` y `# >>> [WPIPE:CUSTOM_LOGIC]`.
4. **Activación Profunda 1-Clic, Enmascaramiento de Clave & Barra Lateral Segura**:
   - Soporte nativo para enlaces profundos `vscode://wisrovi.wpipe-studio-vscode/activate?key=...` emitidos desde `portal.wisrovi.dev` o `admin.wisrovi.dev`.
   - Protección anti-exposición (*shoulder-surfing/screen-sharing*): clave enmascarada por defecto (`WPIPE-PRO-••••-••••-9E5F`), botón de visualización conmutable (👁️/🙈) y botón de copiado directo al portapapeles (📋).
   - Barra lateral reactiva con indicador de puesto en línea (`● En Línea`), sanitización XSS de entidades HTML y aislamiento estricto de orígenes IPC.
5. **Modelo Freemium Transparente**:
   - **Plan Free (Gratuito)**: Permite diseñar pipelines de hasta **5 bloques** sin registro ni tarjeta de crédito.
   - **Plan Pro**: Desbloquea pipelines de complejidad ilimitada, ejecución paralela concurrente (`Parallel`), tareas en segundo plano (`Background`) y depuración paso a paso en vivo con breakpoints.

---

## Comandos Disponibles

- `WPipe: Abrir Lienzo de Bloques`
- `WPipe: Crear Nuevo Pipeline Visual`
- `WPipe: Activar Clave de Licencia Pro`
- `WPipe: Ver Estado de Licencia`
- `WPipe: Compilar Pipeline a Python`
- `WPipe: Iniciar Motor Nativo (wpipe-engine)`

---

## Empaquetado y Publicación (.vsix)

Para compilar y empaquetar la extensión en un archivo instalable `.vsix`:

```bash
# 1. Instalar dependencias
npm install

# 2. Compilar TypeScript
npm run compile

# 3. Empaquetar extensión
npx vsce package
```
El archivo `wpipe-studio-vscode-1.0.0.vsix` resultante puede instalarse en cualquier VS Code desde el menú *Extensions › Install from VSIX...*.
