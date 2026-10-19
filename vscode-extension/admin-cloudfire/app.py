"""WPipe Studio - Cloudflare Admin Web Dashboard
Streamlit Backoffice application to manage licenses, machine activations, R2 binaries, and audit logs.
Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

import datetime
import json
import os
import urllib.request
from typing import Any

import pandas as pd
import streamlit as st
from client import CloudflareAdminClient, generate_license_key

# Configure Streamlit page layout and dark theme
st.set_page_config(
    page_title="WPipe Licensing Admin — wisrovi",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# -----------------------------------------------------------------------------
# Security & Authentication Gate
# -----------------------------------------------------------------------------
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "wisrovi2026")


def check_password() -> bool:
    """Password authentication gate."""
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if st.session_state.authenticated:
        return True

    st.markdown(
        """
        <div style="text-align: center; margin-top: 50px;">
            <h2>🛡️ WPipe Studio — Admin Console</h2>
            <p style="color: #888;">Cloudflare Serverless Licensing Authority (wisrovi SUITE)</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        pwd = st.text_input("Contraseña de Administrador", type="password")
        if st.button("Iniciar Sesión", use_container_width=True, type="primary"):
            if pwd == ADMIN_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Contraseña incorrecta. Acceso denegado.")
    return False


if not check_password():
    st.stop()


# -----------------------------------------------------------------------------
# Client Initialization & Health Check
# -----------------------------------------------------------------------------
@st.cache_resource
def get_client() -> CloudflareAdminClient:
    return CloudflareAdminClient()


client = get_client()


def check_api_health(base_url: str) -> dict[str, Any]:
    try:
        url = f"{base_url}/v1/health"
        req = urllib.request.Request(url, headers={"User-Agent": "wpipe-admin/1.0.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"status": "offline", "error": str(e)}


# -----------------------------------------------------------------------------
# Sidebar Navigation & Context
# -----------------------------------------------------------------------------
with st.sidebar:
    st.markdown("### 🛡️ WPipe Admin")
    st.caption("Ecosistema wisrovi.dev | Cloudflare Edge")

    health = check_api_health(client.api_base_url)
    if health.get("status") == "healthy":
        st.success("🟢 Cloudflare Worker: **ONLINE**")
    else:
        st.warning(f"🟡 Worker API: {health.get('status', 'unknown')}")

    st.divider()
    st.markdown("**Configuración:**")
    st.caption(f"**D1 DB:** `{client.database_id[:8]}...`")
    st.caption(f"**Worker:** `{client.api_base_url}`")

    if st.button("🚪 Cerrar Sesión", use_container_width=True):
        st.session_state.authenticated = False
        st.rerun()

# -----------------------------------------------------------------------------
# Header & KPI Metrics
# -----------------------------------------------------------------------------
st.title("🛡️ Panel de Control de Licencias y Activaciones")
st.caption("Gestión centralizada de suscriptores, huellas de hardware, binarios en R2 y registros de auditoría.")

stats = client.get_stats()

col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric(label="Total Licencias", value=stats["total_licenses"])
with col2:
    st.metric(label="Licencias Activas", value=stats["active_licenses"])
with col3:
    st.metric(label="Máquinas Vinculadas", value=stats["total_activations"])
with col4:
    st.metric(label="Eventos Auditoría (7d)", value=stats["recent_logs_7d"])

st.divider()

# -----------------------------------------------------------------------------
# Tabs Interface
# -----------------------------------------------------------------------------
tab1, tab2, tab3, tab4 = st.tabs([
    "👥 Licencias & Clientes",
    "💻 Máquinas & Leases",
    "📦 Binarios & R2",
    "📜 Logs de Auditoría",
])

# =============================================================================
# TAB 1: Licencias & Clientes
# =============================================================================
with tab1:
    st.subheader("Gestión de Licencias")

    # Form to create a new license
    with st.expander("➕ Crear Nueva Licencia"):
        with st.form("create_license_form"):
            fcol1, fcol2 = st.columns(2)
            with fcol1:
                cust_email = st.text_input("Email del Cliente *", placeholder="cliente@empresa.com")
                cust_name = st.text_input("Nombre / Empresa *", placeholder="Acme Inc.")
                plan = st.selectbox("Plan", ["pro", "team", "enterprise"], index=0)
            with fcol2:
                max_mach = st.number_input("Máquinas Permitidas", min_value=1, max_value=20, value=2)
                duration = st.selectbox(
                    "Duración de la Licencia",
                    ["1 Mes", "1 Año", "Vitalicia (Lifetime)"],
                    index=1,
                )
                custom_key = st.text_input("Clave Personalizada (opcional)", placeholder="Dejar vacío para auto-generar")

            submitted = st.form_submit_button("Generar y Activar Licencia", type="primary")
            if submitted:
                if not cust_email or not cust_name:
                    st.error("El email y el nombre son campos obligatorios.")
                else:
                    # Calculate expiration
                    expires_at = None
                    now = datetime.datetime.now(datetime.timezone.utc)
                    if duration == "1 Mes":
                        expires_at = (now + datetime.timedelta(days=30)).isoformat()
                    elif duration == "1 Año":
                        expires_at = (now + datetime.timedelta(days=365)).isoformat()

                    try:
                        new_lic = client.create_license(
                            customer_email=cust_email,
                            customer_name=cust_name,
                            plan=plan,
                            max_machines=int(max_mach),
                            expires_at=expires_at,
                            custom_key=custom_key if custom_key.strip() else None,
                        )
                        st.success(f"✅ ¡Licencia generada exitosamente! Clave: **`{new_lic['license_key']}`**")
                        st.info("Pega esta clave en la extensión de VS Code con el comando: `WPipe: Activar Licencia Pro`")
                    except Exception as e:
                        st.error(f"Error al crear la licencia: {e}")

    # Search and Filter
    scol1, scol2 = st.columns([3, 1])
    with scol1:
        search_query = st.text_input("🔍 Buscar por Clave, Email o Nombre", placeholder="Filtrar...")
    with scol2:
        status_filter = st.selectbox("Estado", ["all", "active", "suspended", "revoked"])

    try:
        licenses = client.list_licenses(search=search_query, status_filter=status_filter)
        if licenses:
            df_licenses = pd.DataFrame(licenses)
            # Reorder columns for readability
            cols_order = [
                "license_key", "plan", "status", "customer_name", "customer_email",
                "max_machines", "expires_at", "created_at"
            ]
            display_cols = [c for c in cols_order if c in df_licenses.columns]
            st.dataframe(df_licenses[display_cols], use_container_width=True, height=350)

            # Actions on selected license
            st.markdown("#### Acciones sobre Licencias")
            acol1, acol2, acol3 = st.columns([2, 1, 1])
            with acol1:
                selected_lic_id = st.selectbox(
                    "Seleccionar Licencia",
                    options=[f"{l['id']} — {l['license_key']} ({l['customer_email']})" for l in licenses],
                )
                lic_id = selected_lic_id.split(" — ")[0]
            with acol2:
                new_st = st.selectbox("Nuevo Estado", ["active", "suspended", "revoked"])
                if st.button("Actualizar Estado", use_container_width=True):
                    client.update_license_status(lic_id, new_st)
                    st.success(f"Estado actualizado a '{new_st}'.")
                    st.rerun()
            with acol3:
                st.write("")
                st.write("")
                if st.button("🗑️ Eliminar Licencia", type="secondary", use_container_width=True):
                    client.delete_license(lic_id)
                    st.warning("Licencia y activaciones eliminadas.")
                    st.rerun()
        else:
            st.info("No se encontraron licencias registradas.")
    except Exception as e:
        st.error(f"Error al cargar licencias: {e}")

# =============================================================================
# TAB 2: Máquinas & Leases
# =============================================================================
with tab2:
    st.subheader("Equipos Vinculados (Huellas de Hardware Anti-Piratería)")
    st.caption("Cada equipo tiene una huella SHA-256 única vinculada a la licencia del desarrollador.")

    try:
        activations = client.list_activations()
        if activations:
            df_act = pd.DataFrame(activations)
            act_cols = [
                "id", "license_key", "customer_email", "plan", "hostname", "os_name",
                "machine_fingerprint", "last_verified_at", "lease_expires_at"
            ]
            display_act_cols = [c for c in act_cols if c in df_act.columns]
            st.dataframe(df_act[display_act_cols], use_container_width=True, height=350)

            st.markdown("#### Desvincular Equipo")
            st.caption("Si un cliente cambia de ordenador o formatea su sistema, desvincula su máquina anterior para liberar su cupo.")

            dcol1, dcol2 = st.columns([3, 1])
            with dcol1:
                sel_act = st.selectbox(
                    "Seleccionar Activación a Desvincular",
                    options=[f"{a['id']} — {a['hostname'] or 'PC'} ({a['license_key']})" for a in activations],
                )
                act_id = sel_act.split(" — ")[0]
            with dcol2:
                st.write("")
                st.write("")
                if st.button("🔓 Desvincular Máquina", type="primary", use_container_width=True):
                    client.delete_activation(act_id)
                    st.success("Máquina desvinculada exitosamente. El desarrollador puede registrar una nueva máquina.")
                    st.rerun()
        else:
            st.info("Aún no hay máquinas registradas.")
    except Exception as e:
        st.error(f"Error al cargar activaciones: {e}")

# =============================================================================
# TAB 3: Binarios & R2
# =============================================================================
with tab3:
    st.subheader("Distribución de Binarios `wpipe-engine` (Cloudflare R2)")
    st.caption("Los binarios se sirven sin costo de transferencia (Zero-Egress Fees) a los usuarios de VS Code.")

    # Fetch latest manifest
    try:
        manifest_url = f"{client.api_base_url}/v1/downloads/latest"
        req = urllib.request.Request(manifest_url, headers={"User-Agent": "wpipe-admin/1.0.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            manifest_data = json.loads(resp.read().decode("utf-8"))
            st.json(manifest_data)
    except Exception as e:
        st.warning(f"No se pudo consultar el manifiesto en vivo: {e}")

    st.markdown("#### Subida Directa de Binarios Compilados")
    st.info(
        "Para subir binarios a Cloudflare R2 con Wrangler CLI desde tu terminal ejecuta:\n\n"
        "```bash\n"
        "npx wrangler r2 object put wpipe-releases/linux-x64/wpipe-engine --file=daemon_os/dist/wpipe-engine\n"
        "npx wrangler r2 object put wpipe-releases/linux-x64/wpipe-engine.tar.gz --file=daemon_os/dist/wpipe-engine-linux-x64.tar.gz\n"
        "```"
    )

# =============================================================================
# TAB 4: Logs de Auditoría
# =============================================================================
with tab4:
    st.subheader("Registro de Seguridad & Auditoría")
    st.caption("Eventos en tiempo real: activaciones exitosas, claves inválidas, intentos de abuso o renovaciones de lease.")

    lcol1, lcol2 = st.columns([3, 1])
    with lcol1:
        ev_filter = st.selectbox(
            "Tipo de Evento",
            ["all", "activate_success", "activate_failed_not_found", "verify_success", "payment_processed"],
        )
    with lcol2:
        limit_logs = st.number_input("Límite de Registros", min_value=10, max_value=500, value=50, step=10)

    try:
        logs = client.list_audit_logs(limit=int(limit_logs), event_type=ev_filter)
        if logs:
            df_logs = pd.DataFrame(logs)
            st.dataframe(df_logs, use_container_width=True, height=400)
        else:
            st.info("No hay registros de auditoría para el filtro seleccionado.")
    except Exception as e:
        st.error(f"Error al cargar registros: {e}")
