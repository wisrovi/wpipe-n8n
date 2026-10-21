# wpipe-engine — Daemon Nativo de Sistema & Motor Local

Motor nativo del sistema y servidor de licencias local para **WPipe Studio (wisrovi SUITE)**. Ejecuta la compilación de pipelines, la verificación criptográfica de arrendamientos (*leases*) y el control de límites freemium en la máquina del desarrollador.

> **Autor**: William Rodriguez (AI Leader & Solutions Architect — [wisrovi.dev](https://wisrovi.dev))  
> **Licencia**: Propietaria (wisrovi)

---

## Tecnologías y Librerías Relevantes

| Tecnología | Rol en el Daemon |
|---|---|
| **Python 3.11+ / CPython** | Runtime principal para el motor de pipelines y generación de código AST. |
| **Cryptography (PyCA)** | Verificación de firmas asimétricas Ed25519 sobre tokens compactos JWS/JWT. |
| **Unix Domain Sockets (`socket.AF_UNIX`)** | Canal IPC local de ultra-baja latencia entre VS Code y el daemon sin exponer puertos de red. |
| **HTTP Localhost (`127.0.0.1:49152`)** | Transporte IPC alternativo para Windows o entornos sin soporte de sockets Unix. |
| **Nuitka / PyInstaller** | Compilación anticipada (AOT) a binario C cerrado para protección estricta contra ingeniería inversa. |
| **Pytest** | Suite de pruebas unitarias automatizadas para licencias, cuotas freemium y compilación. |

---

## Capacidades Principales

1. **Hardware Machine Fingerprinting & Floating Seats**:
   - Genera una huella SHA-256 reproducible a partir del UUID de la placa base, ID de CPU y dirección MAC.
   - Es agnóstica del usuario del SO: múltiples cuentas locales (`/home/juan`, `/home/maria`) en el mismo PC consumen **1 solo asiento**.
   - Hilo en segundo plano que envía *heartbeats* cada 30 min para renovar el TTL de 2 horas.
   - En caso de concurrencia excedida (`409 SEATS_EXCEEDED`), degrada elegantemente a la Capa Free (≤ 5 bloques) con enlace a `portal.wisrovi.dev`.
2. **Enforcer Freemium Estricto**:
   - **Plan Free / Community**: Permite hasta **5 bloques** por pipeline. Bloquea el uso de bloques Pro (`Parallel`, `Background`, `AI Step`) con código `PRO_FEATURE_REQUIRED` y enlace a `wisrovi.dev`.
   - **Plan Pro**: Desbloquea bloques ilimitados, concurrencia, Smart AST code merge y depuración paso a paso.
3. **Smart AST Code Merge**:
   - Preserva los bloques `# >>> [WPIPE:CUSTOM_IMPORTS]` y `# >>> [WPIPE:CUSTOM_LOGIC]` escritos manualmente por el usuario.
4. **Validación Offline con Período de Gracia**:
   - Valida el token firmado sin necesidad de conexión constante a internet, con 7 días de gracia adicionales.

---

## Comandos CLI

```bash
# Ver estado actual de la licencia y cuotas
./wpipe_engine/main.py status

# Ver el Machine Fingerprint del equipo
./wpipe_engine/main.py fingerprint

# Activar una clave de licencia contra Cloudflare Edge (api.wisrovi.dev)
./wpipe_engine/main.py activate WPIPE-PRO-DEMO-TEST-KEY-2026

# Iniciar el daemon IPC en segundo plano
./wpipe_engine/main.py daemon --socket /tmp/wpipe.sock
```

---

## Ejecución de Pruebas Unitarias y Cobertura

```bash
# Ejecutar suite de pruebas con pytest
pytest tests/ -v

# Calcular cobertura de código
./coverage.sh
```
La suite incluye 13 tests cubriendo verificación de firmas Ed25519, tokens adulterados, límites de 5 bloques y preservación de código AST.

---

## Compilación a Binario Cerrado

```bash
./build.sh
```
Genera el binario ejecutable `dist/wpipe-engine` para distribución en Cloudflare R2 (`downloads.wisrovi.dev`).
