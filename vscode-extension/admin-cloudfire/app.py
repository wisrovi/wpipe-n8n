"""WPipe Studio - Cloudflare Admin Web Dashboard
Streamlit Backoffice application driven by WPipe Pipeline Architecture (wisrovi standard).
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
from client import CloudflareAdminClient
from pipelines import create_admin_pipeline

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
            <p style="color: #888;">Cloudflare Serverless Licensing Authority (WPipe Pipeline Driven)</p>
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
# WPipe Pipeline & Client Initialization
# -----------------------------------------------------------------------------
@st.cache_resource
def get_admin_resources():
    admin_client = CloudflareAdminClient()
    pipeline = create_admin_pipeline(admin_client)
    return admin_client, pipeline


client, admin_pipeline = get_admin_resources()


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
    st.caption("Ecosistema wisrovi.dev | WPipe Architecture")

    health = check_api_health(client.api_base_url)
    if health.get("status") == "healthy":
        st.success("🟢 Cloudflare Worker: **ONLINE**")
    else:
        st.warning(f"🟡 Worker API: {health.get('status', 'unknown')}")

    st.divider()
    st.markdown("**Arquitectura:**")
    st.caption("⚙️ **Engine:** `WPipe Pipeline v2.5`")
    st.caption(f"**D1 DB:** `{client.database_id[:8]}...`")
    st.caption(f"**Worker:** `{client.api_base_url}`")

    if st.button("🚪 Cerrar Sesión", use_container_width=True):
        st.session_state.authenticated = False
        st.rerun()

# -----------------------------------------------------------------------------
# Header & Data Loading via WPipe Pipeline
# -----------------------------------------------------------------------------
st.title("🛡️ Panel de Control de Licencias y Activaciones")
st.caption("Orquestado nativamente con WPipe Pipeline (DTOs + Steps + States).")

# Initial run to fetch full state
with st.spinner("Ejecutando pipeline WPipe..."):
    pipe_result = admin_pipeline.run({"action": "fetch_all", "status_filter": "all"})

stats = pipe_result.get("stats", {})
licenses = pipe_result.get("licenses", [])
activations = pipe_result.get("activations", [])
audit_logs = pipe_result.get("audit_logs", [])

col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric(label="Total Licencias", value=stats.get("total_licenses", 0))
with col2:
    st.metric(label="Licencias Activas", value=stats.get("active_licenses", 0))
with col3:
    st.metric(label="Máquinas Vinculadas", value=stats.get("total_activations", 0))
with col4:
    st.metric(label="Eventos Auditoría (7d)", value=stats.get("recent_logs_7d", 0))

st.divider()

# -----------------------------------------------------------------------------
# Tabs Interface
# -----------------------------------------------------------------------------
tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "👥 Licencias & Clientes",
    "💻 Máquinas & Leases",
    "📦 Binarios & R2",
    "📜 Logs de Auditoría",
    "💳 Pasarelas (Lemon / Stripe)",
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
                        res = admin_pipeline.run({
                            "action": "create_license",
                            "license_input": {
                                "customer_email": cust_email,
                                "customer_name": cust_name,
                                "plan": plan,
                                "max_machines": int(max_mach),
                                "expires_at": expires_at,
                                "custom_key": custom_key if custom_key.strip() else None,
                            },
                        })
                        st.success("✅ ¡Licencia generada exitosamente vía WPipe Pipeline!")
                        st.info("Pega esta clave en la extensión de VS Code con el comando: `WPipe: Activar Licencia Pro`")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Error al crear la licencia: {e}")

    # Search and Filter
    scol1, scol2 = st.columns([3, 1])
    with scol1:
        search_query = st.text_input("🔍 Buscar por Clave, Email o Nombre", placeholder="Filtrar...")
    with scol2:
        status_filter = st.selectbox("Estado", ["all", "active", "suspended", "revoked"])

    filtered_licenses = licenses
    if search_query or status_filter != "all":
        res_filter = admin_pipeline.run({
            "action": "fetch_all",
            "search_query": search_query if search_query else None,
            "status_filter": status_filter,
        })
        filtered_licenses = res_filter.get("licenses", [])

    if filtered_licenses:
        df_licenses = pd.DataFrame(filtered_licenses)
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
                options=[f"{l['id']} — {l['license_key']} ({l['customer_email']})" for l in filtered_licenses],
            )
            lic_id = selected_lic_id.split(" — ")[0]
        with acol2:
            new_st = st.selectbox("Nuevo Estado", ["active", "suspended", "revoked"])
            if st.button("Actualizar Estado", use_container_width=True):
                admin_pipeline.run({
                    "action": "update_license",
                    "target_id": lic_id,
                    "target_status": new_st,
                })
                st.success(f"Estado actualizado a '{new_st}' vía WPipe Pipeline.")
                st.rerun()
        with acol3:
            st.write("")
            st.write("")
            if st.button("🗑️ Eliminar Licencia", type="secondary", use_container_width=True):
                admin_pipeline.run({
                    "action": "delete_license",
                    "target_id": lic_id,
                })
                st.warning("Licencia eliminada vía WPipe Pipeline.")
                st.rerun()
    else:
        st.info("No se encontraron licencias registradas.")

# =============================================================================
# TAB 2: Máquinas & Leases
# =============================================================================
with tab2:
    st.subheader("Equipos Vinculados (Huellas de Hardware Anti-Piratería)")
    st.caption("Cada equipo tiene una huella SHA-256 única vinculada a la licencia del desarrollador.")

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
                options=[f"{a['id']} — {a.get('hostname') or 'PC'} ({a.get('license_key') or ''})" for a in activations],
            )
            act_id = sel_act.split(" — ")[0]
        with dcol2:
            st.write("")
            st.write("")
            if st.button("🔓 Desvincular Máquina", type="primary", use_container_width=True):
                admin_pipeline.run({
                    "action": "delete_activation",
                    "target_id": act_id,
                })
                st.success("Máquina desvinculada exitosamente vía WPipe Pipeline.")
                st.rerun()
    else:
        st.info("Aún no hay máquinas registradas.")

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
    st.caption("Eventos en tiempo real cargados por ManageAuditStep.")

    lcol1, lcol2 = st.columns([3, 1])
    with lcol1:
        ev_filter = st.selectbox(
            "Tipo de Evento",
            ["all", "activate_success", "activate_failed_not_found", "verify_success", "payment_processed"],
        )
    with lcol2:
        limit_logs = st.number_input("Límite de Registros", min_value=10, max_value=500, value=50, step=10)

    filtered_logs = audit_logs
    if ev_filter != "all":
        filtered_logs = [log for log in audit_logs if log.get("event_type") == ev_filter]

    if filtered_logs:
        df_logs = pd.DataFrame(filtered_logs[:int(limit_logs)])
        st.dataframe(df_logs, use_container_width=True, height=400)
    else:
        st.info("No hay registros de auditoría para el filtro seleccionado.")

# =============================================================================
# TAB 5: Pasarelas de Pago (Lemon Squeezy / Stripe)
# =============================================================================
with tab5:
    st.subheader("💳 Integración de Pasarelas de Pago")
    st.caption("Configuración de webhooks automáticos para emisión de licencias en tiempo real tras la compra.")

    st.markdown("#### 🔗 Endpoint Webhook Global")
    webhook_url = f"{client.api_base_url}/v1/webhooks/payment"
    st.code(webhook_url, language="bash")
    st.info("Pega esta URL en el panel de desarrollador de Lemon Squeezy o Stripe para recibir las compras automáticamente.")

    col_lemon, col_stripe = st.columns(2)
    with col_lemon:
        st.markdown("### 🍋 Lemon Squeezy")
        st.markdown(
            """
            1. Entra a tu **Dashboard de Lemon Squeezy** → **Settings** → **Webhooks**.
            2. Haz clic en **Add Webhook**.
            3. **Callback URL**: `https://api.wisrovi.dev/v1/webhooks/payment`
            4. **Eventos a seleccionar**:
               - `order_created`
               - `subscription_created`
               - `subscription_cancelled`
            5. *(Opcional)* Copia el **Signing Secret** y configúralo en Cloudflare:
               ```bash
               npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
               ```
            """
        )

    with col_stripe:
        st.markdown("### 💳 Stripe")
        st.markdown(
            """
            1. Entra a tu **Dashboard de Stripe** → **Desarrolladores** → **Webhooks**.
            2. Haz clic en **Añadir endpoint**.
            3. **URL del endpoint**: `https://api.wisrovi.dev/v1/webhooks/payment`
            4. **Eventos a seleccionar**:
               - `checkout.session.completed`
               - `customer.subscription.deleted`
            5. *(Opcional)* Copia el **Secreto para firmar** (`whsec_...`) y configúralo en Cloudflare:
               ```bash
               npx wrangler secret put STRIPE_WEBHOOK_SECRET
               ```
            """
        )

    st.divider()
    st.markdown("#### 🧪 Simulador de Webhooks (Prueba de Compra en Vivo)")
    st.caption("Dispara un webhook simulado hacia Cloudflare Worker para verificar la emisión de la clave en la base de datos D1.")

    with st.form("simulate_webhook_form"):
        sim_col1, sim_col2, sim_col3 = st.columns(3)
        with sim_col1:
            gateway = st.selectbox("Pasarela a Simular", ["Lemon Squeezy", "Stripe"])
            sim_plan = st.selectbox("Plan Comprado", ["pro", "team", "enterprise"])
        with sim_col2:
            sim_email = st.text_input("Email del Comprador", value="comprador@wisrovi.dev")
            sim_name = st.text_input("Nombre del Comprador", value="William Rodriguez")
        with sim_col3:
            st.markdown("<br>", unsafe_allow_html=True)
            sim_submit = st.form_submit_button("🚀 Simular Compra y Emitir Licencia", type="primary", use_container_width=True)

        if sim_submit:
            with st.spinner("Enviando webhook de prueba a Cloudflare..."):
                try:
                    if gateway == "Lemon Squeezy":
                        sim_payload = {
                            "meta": {
                                "event_name": "order_created",
                                "custom_data": {"plan": sim_plan},
                            },
                            "data": {
                                "attributes": {
                                    "user_email": sim_email,
                                    "user_name": sim_name,
                                    "first_order_item": {"variant_name": sim_plan.upper()},
                                },
                            },
                        }
                    else:
                        sim_payload = {
                            "type": "checkout.session.completed",
                            "data": {
                                "object": {
                                    "customer_details": {
                                        "email": sim_email,
                                        "name": sim_name,
                                    },
                                    "metadata": {"plan": sim_plan},
                                },
                            },
                        }

                    req = urllib.request.Request(
                        webhook_url,
                        data=json.dumps(sim_payload).encode("utf-8"),
                        headers={"Content-Type": "application/json", "User-Agent": "WPipe-Simulator/1.0"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        res_data = json.loads(resp.read().decode("utf-8"))

                    st.success(f"🎉 ¡Compra procesada exitosamente por el webhook de {gateway}!")
                    st.json(res_data)
                    st.code(res_data.get("license_key", ""), language="text")
                    st.info("La licencia ya está guardada en Cloudflare D1. El usuario puede activarla en VS Code.")
                except Exception as e:
                    st.error(f"Error al enviar webhook simulado: {e}")

