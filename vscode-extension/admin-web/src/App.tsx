/**
 * WPipe Studio - Super-Admin Web Console
 * Deployed at: admin.wisrovi.dev (Cloudflare Pages at 0 €/month)
 * Complete Administrative Control: D1 SQL Console, VIP Minter, License Manager & Leases Monitor
 * Author: William Rodriguez (wisrovi.dev)
 */

import React, { useState, useEffect } from "react";
import {
  Shield,
  Database,
  Users,
  Laptop,
  Terminal,
  Activity,
  RefreshCw,
  LogOut,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Play,
  Search,
  Lock,
  Sparkles,
} from "lucide-react";

const API_BASE = "https://api.wisrovi.dev";

interface AdminStats {
  total_licenses: number;
  active_licenses: number;
  active_floating_leases: number;
  recent_audit_events_7d: number;
  server_timestamp: string;
}

interface LicenseRecord {
  id: string;
  license_key: string;
  admin_key?: string;
  customer_email: string;
  customer_name: string;
  plan: string;
  status: string;
  max_seats: number;
  expires_at: string | null;
  created_at: string;
}

interface LeaseRecord {
  id: string;
  license_id: string;
  license_key?: string;
  customer_email?: string;
  machine_fingerprint: string;
  hostname: string | null;
  os_name: string | null;
  last_heartbeat_at: string;
  lease_expires_at: string;
  created_at: string;
}

export default function App() {
  const [masterKey, setMasterKey] = useState<string>(() => localStorage.getItem("wpipe_admin_master_token") || "");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"overview" | "licenses" | "vip_minter" | "leases" | "sql_console" | "audit">("overview");

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Module States
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // VIP Minter State
  const [vipName, setVipName] = useState<string>("");
  const [vipEmail, setVipEmail] = useState<string>("");
  const [vipPlan, setVipPlan] = useState<string>("enterprise");
  const [vipSeats, setVipSeats] = useState<number>(5);
  const [vipCustomKey, setVipCustomKey] = useState<string>("");
  const [vipResult, setVipResult] = useState<any>(null);

  // Leases State
  const [leases, setLeases] = useState<LeaseRecord[]>([]);

  // SQL Console State
  const [sqlQuery, setSqlQuery] = useState<string>(
    "SELECT id, license_key, admin_key, plan, max_seats, status, customer_email FROM licenses ORDER BY created_at DESC;"
  );
  const [sqlResults, setSqlResults] = useState<any[] | null>(null);
  const [sqlMeta, setSqlMeta] = useState<any>(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Execute authenticated SQL query
  const executeSql = async (sql: string, params: any[] = []): Promise<any> => {
    const res = await fetch(`${API_BASE}/v1/admin/sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${masterKey}`,
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al ejecutar SQL en Cloudflare D1.");
    }
    return res.json();
  };

  // Verify Master Key Authentication
  const verifyAuth = async (keyToVerify: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/admin/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_key: keyToVerify }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || "Contraseña de Super-Admin no válida.");
      }
      localStorage.setItem("wpipe_admin_master_token", keyToVerify);
      setIsAuthenticated(true);
      fetchInitialData(keyToVerify);
    } catch (err: any) {
      setError(err.message || "Error al autenticar acceso.");
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (masterKey) {
      verifyAuth(masterKey);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterKey.trim()) return;
    verifyAuth(masterKey.trim());
  };

  const handleLogout = () => {
    localStorage.removeItem("wpipe_admin_master_token");
    setMasterKey("");
    setIsAuthenticated(false);
    setStats(null);
    setLicenses([]);
    setLeases([]);
    setAuditLogs([]);
    setError(null);
    setSuccessNotice(null);
  };

  // Fetch initial system metrics & data
  const fetchInitialData = async (token = masterKey) => {
    setLoading(true);
    try {
      // 1. Stats
      const statsRes = await fetch(`${API_BASE}/v1/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // 2. Licenses list
      const licRes = await executeSql(
        "SELECT id, license_key, admin_key, customer_name, customer_email, plan, status, max_seats, expires_at, created_at FROM licenses ORDER BY created_at DESC"
      );
      if (licRes.success) {
        setLicenses(licRes.results || []);
      }

      // 3. Leases list
      const leasesRes = await executeSql(
        `SELECT le.id, le.license_id, le.machine_fingerprint, le.hostname, le.os_name, le.last_heartbeat_at, le.lease_expires_at, le.created_at,
                li.license_key, li.customer_email
         FROM leases le
         LEFT JOIN licenses li ON le.license_id = li.id
         WHERE le.lease_expires_at > datetime('now')
         ORDER BY le.last_heartbeat_at DESC`
      );
      if (leasesRes.success) {
        setLeases(leasesRes.results || []);
      }
    } catch (err: any) {
      setError(err.message || "Error al cargar datos del sistema.");
    } finally {
      setLoading(false);
    }
  };

  // License Status & Seat Mutations
  const handleUpdateLicenseStatus = async (id: string, newStatus: string) => {
    try {
      setLoading(true);
      await executeSql("UPDATE licenses SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, id]);
      setSuccessNotice(`Estado de la licencia actualizado a "${newStatus}".`);
      await fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSeats = async (id: string, currentSeats: number, delta: number) => {
    const newSeats = Math.max(1, currentSeats + delta);
    try {
      setLoading(true);
      await executeSql("UPDATE licenses SET max_seats = ?, max_machines = ?, updated_at = datetime('now') WHERE id = ?", [newSeats, newSeats, id]);
      setSuccessNotice(`Asientos actualizados a ${newSeats}.`);
      await fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Mint VIP License
  const handleMintVip = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setVipResult(null);

    try {
      const res = await fetch(`${API_BASE}/v1/admin/licenses/vip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey}`,
        },
        body: JSON.stringify({
          customer_name: vipName.trim() || "VIP Partner",
          customer_email: vipEmail.trim().toLowerCase() || "vip@wisrovi.dev",
          plan: vipPlan,
          max_seats: vipSeats,
          custom_key: vipCustomKey.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || "Error al minar licencia VIP.");
      }

      setVipResult(json);
      setSuccessNotice(`¡Licencia VIP creada con éxito!`);
      await fetchInitialData();
    } catch (err: any) {
      setError(err.message || "Error al generar licencia VIP.");
    } finally {
      setLoading(false);
    }
  };

  // Kick Lease Globally
  const handleKickLease = async (leaseId: string, hostname: string | null) => {
    if (!window.confirm(`¿Seguro que deseas terminar forzosamente el lease de "${hostname || "PC"}"?`)) return;
    try {
      setLoading(true);
      await executeSql("DELETE FROM leases WHERE id = ?", [leaseId]);
      setSuccessNotice(`Lease liberado forzosamente.`);
      await fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Execute SQL in Console
  const handleRunSql = async () => {
    if (!sqlQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const start = performance.now();
      const res = await executeSql(sqlQuery);
      const elapsed = (performance.now() - start).toFixed(1);
      setSqlResults(res.results || []);
      setSqlMeta({ ...(res.meta || {}), execution_time_ms: elapsed });
    } catch (err: any) {
      setError(err.message);
      setSqlResults(null);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs
  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const res = await executeSql(
        "SELECT id, event_type, license_key, ip_address, details_json, created_at FROM audit_logs ORDER BY id DESC LIMIT 100"
      );
      if (res.success) {
        setAuditLogs(res.results || []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "audit" && isAuthenticated) {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // ---------------------------------------------------------------------------
  // VIEW: Login Screen
  // ---------------------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#0a0f1d] to-[#04060a]">
        <div className="w-full max-w-md bg-[#0f172a] border border-indigo-700/60 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-600 to-pink-600 flex items-center justify-center text-white text-3xl shadow-xl shadow-indigo-500/25 mb-4">
              🛡️
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              WPipe Studio
            </h1>
            <p className="text-xs text-indigo-400 font-bold tracking-widest uppercase mt-1">
              Super-Admin Master Console
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Panel maestro exclusivo para William Rodriguez. Control central de licencias, leases globales y base de datos Cloudflare D1.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/80 border border-red-700/80 rounded-lg text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center justify-between">
                <span>Contraseña Maestra de Super-Admin</span>
                <Lock size={12} className="text-indigo-400" />
              </label>
              <input
                type="password"
                value={masterKey}
                onChange={(e) => setMasterKey(e.target.value)}
                placeholder="Introduce tu clave de Super-Admin..."
                className="w-full px-3.5 py-2.5 bg-gray-900/90 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-600 hover:from-indigo-400 hover:to-pink-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-indigo-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Shield size={14} />
              <span>{loading ? "Verificando acceso..." : "Acceder a Consola Maestra"}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Filtered Licenses
  // ---------------------------------------------------------------------------
  const filteredLicenses = licenses.filter((lic) => {
    const matchesSearch =
      !searchQuery ||
      lic.license_key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lic.admin_key && lic.admin_key.toLowerCase().includes(searchQuery.toLowerCase())) ||
      lic.customer_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lic.customer_name.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || lic.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // ---------------------------------------------------------------------------
  // VIEW: Super-Admin Master Dashboard
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#060911] text-gray-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-gray-800/80 bg-[#0c1220]/95 backdrop-blur-md px-6 py-3 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-pink-600 flex items-center justify-center text-white text-base shadow-md">
            🛡️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base tracking-tight text-white">
                WPipe Studio HQ
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-mono font-bold uppercase">
                Super-Admin
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              William Rodriguez &bull; wisrovi.dev authority
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-gray-900/90 p-1 rounded-xl border border-gray-800">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "overview" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Activity size={13} />
            <span>Métricas</span>
          </button>
          <button
            onClick={() => setActiveTab("licenses")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "licenses" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Users size={13} />
            <span>Licencias ({licenses.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("vip_minter")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "vip_minter" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Sparkles size={13} />
            <span>Minador VIP</span>
          </button>
          <button
            onClick={() => setActiveTab("leases")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "leases" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Laptop size={13} />
            <span>Leases ({leases.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("sql_console")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "sql_console" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Terminal size={13} />
            <span>Consola SQL</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === "audit" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            <Database size={13} />
            <span>Auditoría</span>
          </button>
        </nav>

        {/* Global Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchInitialData()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition cursor-pointer"
            title="Refrescar datos en vivo"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/60 text-xs text-red-300 transition cursor-pointer"
          >
            <LogOut size={13} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Banner Messages */}
        {error && (
          <div className="p-3.5 bg-red-950/80 border border-red-700 rounded-xl text-xs text-red-200 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white cursor-pointer">
              ✕
            </button>
          </div>
        )}

        {successNotice && (
          <div className="p-3.5 bg-emerald-950/80 border border-emerald-700 rounded-xl text-xs text-emerald-200 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{successNotice}</span>
            </div>
            <button onClick={() => setSuccessNotice(null)} className="text-emerald-400 hover:text-white cursor-pointer">
              ✕
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 1: OVERVIEW METRICS */}
        {/* =================================================================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
                <span className="text-xs text-gray-400 font-medium">Total de Licencias</span>
                <div className="text-3xl font-black text-white mt-1">
                  {stats?.total_licenses ?? licenses.length}
                </div>
                <span className="text-[11px] text-indigo-400 mt-1 block">
                  Contratos registrados en D1
                </span>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
                <span className="text-xs text-gray-400 font-medium">Licencias Activas</span>
                <div className="text-3xl font-black text-emerald-400 mt-1">
                  {stats?.active_licenses ?? licenses.filter((l) => l.status === "active").length}
                </div>
                <span className="text-[11px] text-emerald-500/80 mt-1 block">
                  Habilitadas para emitir leases
                </span>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
                <span className="text-xs text-gray-400 font-medium">Puestos Flotantes en Vivo</span>
                <div className="text-3xl font-black text-amber-400 mt-1">
                  {stats?.active_floating_leases ?? leases.length}
                </div>
                <span className="text-[11px] text-amber-400/80 mt-1 block">
                  Estaciones con heartbeat activo
                </span>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
                <span className="text-xs text-gray-400 font-medium">Eventos de Auditoría (7d)</span>
                <div className="text-3xl font-black text-purple-400 mt-1">
                  {stats?.recent_audit_events_7d ?? 0}
                </div>
                <span className="text-[11px] text-purple-400/80 mt-1 block">
                  Leases, webhooks y OTPs
                </span>
              </div>
            </div>

            {/* Infrastructure Health Card */}
            <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Activity size={18} className="text-indigo-400" />
                <span>Estado de Infraestructura Serverless</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-white block">Cloudflare D1 (wpipe_licenses)</span>
                    <span className="text-[11px] text-gray-400">Latencia Edge &lt; 20 ms &bull; SQLite distribuido</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-white block">Resend API (security@wisrovi.dev)</span>
                    <span className="text-[11px] text-gray-400">DKIM & SPF verificados &bull; OTP activo</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-900/60 border border-gray-800 rounded-xl flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <span className="text-xs font-bold text-white block">Cloudflare R2 (wpipe-releases)</span>
                    <span className="text-[11px] text-gray-400">Zero egress fee &bull; Binarios wpipe-engine</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: LICENSES MANAGEMENT */}
        {/* =================================================================== */}
        {activeTab === "licenses" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users size={18} className="text-indigo-400" />
                  <span>Gestor Global de Licencias ({filteredLicenses.length})</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Visualiza, suspende, revoca o ajusta asientos de cualquier cliente de WPipe Studio.
                </p>
              </div>

              {/* Search & Filter */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar clave, correo o cliente..."
                    className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-56 font-mono"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activas</option>
                  <option value="suspended">Suspendidas</option>
                  <option value="expired">Expiradas</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="pb-3 font-semibold">Clave de Puesto (VS Code)</th>
                    <th className="pb-3 font-semibold">Clave Admin Privada</th>
                    <th className="pb-3 font-semibold">Cliente</th>
                    <th className="pb-3 font-semibold">Plan</th>
                    <th className="pb-3 font-semibold">Asientos</th>
                    <th className="pb-3 font-semibold">Estado</th>
                    <th className="pb-3 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {filteredLicenses.map((lic) => (
                    <tr key={lic.id} className="hover:bg-gray-800/30 transition">
                      <td className="py-3 text-white font-bold">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[170px]">{lic.license_key}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(lic.license_key)}
                            className="text-gray-500 hover:text-white cursor-pointer"
                            title="Copiar clave de puesto"
                          >
                            {copiedKey === lic.license_key ? (
                              <CheckCircle2 size={11} className="text-emerald-400" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 text-purple-300">
                        {lic.admin_key ? (
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[170px]">{lic.admin_key}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(lic.admin_key!)}
                              className="text-gray-500 hover:text-purple-300 cursor-pointer"
                              title="Copiar clave admin"
                            >
                              {copiedKey === lic.admin_key ? (
                                <CheckCircle2 size={11} className="text-emerald-400" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>

                      <td className="py-3 text-gray-300 font-sans">
                        <div className="font-semibold text-white">{lic.customer_name || "Cliente"}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{lic.customer_email}</div>
                      </td>

                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-gray-800 text-gray-300 border border-gray-700">
                          {lic.plan}
                        </span>
                      </td>

                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleUpdateSeats(lic.id, lic.max_seats, -1)}
                            className="w-5 h-5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center cursor-pointer font-bold"
                          >
                            -
                          </button>
                          <span className="font-bold text-white w-6 text-center">{lic.max_seats}</span>
                          <button
                            onClick={() => handleUpdateSeats(lic.id, lic.max_seats, 1)}
                            className="w-5 h-5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center cursor-pointer font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            lic.status === "active"
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : "bg-red-950 text-red-300 border border-red-800"
                          }`}
                        >
                          {lic.status}
                        </span>
                      </td>

                      <td className="py-3 text-right font-sans">
                        {lic.status === "active" ? (
                          <button
                            onClick={() => handleUpdateLicenseStatus(lic.id, "suspended")}
                            className="px-2.5 py-1 bg-amber-950/70 hover:bg-amber-900 border border-amber-800 text-amber-200 rounded text-[11px] font-semibold cursor-pointer"
                          >
                            Suspender
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateLicenseStatus(lic.id, "active")}
                            className="px-2.5 py-1 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-800 text-emerald-200 rounded text-[11px] font-semibold cursor-pointer"
                          >
                            Activar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: VIP LICENSE MINTER */}
        {/* =================================================================== */}
        {activeTab === "vip_minter" && (
          <div className="max-w-2xl mx-auto bg-[#0f172a] border border-gray-800 rounded-2xl p-7 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles size={20} className="text-purple-400" />
                <span>Minador VIP & Partners de Licencias</span>
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                Genera licencias maestras para socios estratégicos o clientes corporativos especiales directamente en Cloudflare D1.
              </p>
            </div>

            <form onSubmit={handleMintVip} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Nombre del Socio / Empresa</label>
                  <input
                    type="text"
                    value={vipName}
                    onChange={(e) => setVipName(e.target.value)}
                    placeholder="Ej. eCaptureDtech / Partner VIP"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-sans"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Correo Electrónico Corporativo</label>
                  <input
                    type="email"
                    value={vipEmail}
                    onChange={(e) => setVipEmail(e.target.value)}
                    placeholder="partner@empresa.com"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Plan</label>
                  <select
                    value={vipPlan}
                    onChange={(e) => setVipPlan(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="enterprise">Enterprise</option>
                    <option value="team">Team</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Asientos Concurrentes</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={vipSeats}
                    onChange={(e) => setVipSeats(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Clave Personalizada (Opcional)</label>
                  <input
                    type="text"
                    value={vipCustomKey}
                    onChange={(e) => setVipCustomKey(e.target.value)}
                    placeholder="WPIPE-VIP-PARTNER-2026"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono uppercase"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 via-indigo-600 to-sky-600 hover:from-purple-500 hover:to-sky-500 text-white font-semibold rounded-lg text-xs shadow-lg shadow-purple-600/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Sparkles size={14} />
                <span>{loading ? "Minando licencia en Cloudflare D1..." : "Minar Licencia VIP Inmediatamente"}</span>
              </button>
            </form>

            {vipResult && (
              <div className="p-4 bg-purple-950/40 border border-purple-800 rounded-xl space-y-3 animate-in fade-in">
                <span className="text-xs font-bold text-purple-300 block">Resultado de Emisión VIP:</span>
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between bg-gray-900/90 p-2.5 rounded border border-gray-800">
                    <div>
                      <span className="text-gray-400 block text-[10px]">Clave de Puesto (VS Code):</span>
                      <strong className="text-white">{vipResult.license_key}</strong>
                    </div>
                    <button
                      onClick={() => handleCopy(vipResult.license_key)}
                      className="px-2 py-1 bg-purple-900 hover:bg-purple-800 text-purple-200 rounded text-[11px] cursor-pointer"
                    >
                      {copiedKey === vipResult.license_key ? "¡Copiado!" : "Copiar"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-gray-900/90 p-2.5 rounded border border-gray-800">
                    <div>
                      <span className="text-gray-400 block text-[10px]">Clave de Administración (Privada):</span>
                      <strong className="text-purple-300">{vipResult.admin_key}</strong>
                    </div>
                    <button
                      onClick={() => handleCopy(vipResult.admin_key)}
                      className="px-2 py-1 bg-purple-900 hover:bg-purple-800 text-purple-200 rounded text-[11px] cursor-pointer"
                    >
                      {copiedKey === vipResult.admin_key ? "¡Copiado!" : "Copiar"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: FLOATING LEASES MONITOR */}
        {/* =================================================================== */}
        {activeTab === "leases" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Laptop size={18} className="text-amber-400" />
                  <span>Leases Flotantes Concurrentes en Tiempo Real ({leases.length})</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Estaciones de trabajo de todo el mundo actualmente conectadas con su último heartbeat.
                </p>
              </div>

              <button
                onClick={async () => {
                  await executeSql("DELETE FROM leases WHERE lease_expires_at < datetime('now');");
                  await fetchInitialData();
                }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded-lg cursor-pointer"
              >
                🧹 Limpiar Expirados
              </button>
            </div>

            {leases.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="pb-3 font-semibold">Equipo / Hostname</th>
                      <th className="pb-3 font-semibold">Sistema Operativo</th>
                      <th className="pb-3 font-semibold">Licencia Asignada</th>
                      <th className="pb-3 font-semibold">Último Heartbeat</th>
                      <th className="pb-3 font-semibold">Caducidad Lease</th>
                      <th className="pb-3 font-semibold text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60 font-mono">
                    {leases.map((le) => (
                      <tr key={le.id} className="hover:bg-gray-800/30 transition">
                        <td className="py-3 text-white font-bold">{le.hostname || "Estación"}</td>
                        <td className="py-3 text-gray-300">{le.os_name || "Desconocido"}</td>
                        <td className="py-3 text-sky-400">{le.license_key || le.license_id}</td>
                        <td className="py-3 text-gray-400">{le.last_heartbeat_at}</td>
                        <td className="py-3 text-amber-300">{le.lease_expires_at}</td>
                        <td className="py-3 text-right font-sans">
                          <button
                            onClick={() => handleKickLease(le.id, le.hostname)}
                            className="px-2.5 py-1 bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-200 rounded text-[11px] font-semibold cursor-pointer"
                          >
                            🔓 Kick
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 bg-gray-900/40 rounded-lg border border-dashed border-gray-800 text-gray-400 text-xs">
                No hay puestos flotantes en uso en este momento.
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 5: SQL CONSOLE */}
        {/* =================================================================== */}
        {activeTab === "sql_console" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Terminal size={18} className="text-emerald-400" />
                <span>Consola SQL Directa sobre Cloudflare D1</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Ejecuta consultas interactivas y sentencias sobre la base de datos de producción con privilegios maestros.
              </p>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSqlQuery("SELECT id, license_key, admin_key, plan, max_seats, status, customer_email FROM licenses ORDER BY created_at DESC;")}
                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs cursor-pointer"
              >
                📋 Licencias
              </button>
              <button
                type="button"
                onClick={() => setSqlQuery("SELECT * FROM leases WHERE lease_expires_at > datetime('now');")}
                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs cursor-pointer"
              >
                🟢 Leases Activos
              </button>
              <button
                type="button"
                onClick={() => setSqlQuery("SELECT id, email, attempts, expires_at, used, created_at FROM otp_codes ORDER BY created_at DESC LIMIT 20;")}
                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs cursor-pointer"
              >
                ✉️ Códigos OTP
              </button>
              <button
                type="button"
                onClick={() => setSqlQuery("SELECT event_type, count(*) as count FROM audit_logs GROUP BY event_type ORDER BY count DESC;")}
                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs cursor-pointer"
              >
                📊 Eventos por Tipo
              </button>
            </div>

            {/* Query Editor */}
            <div>
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                rows={4}
                className="w-full p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 leading-relaxed"
              />
            </div>

            <button
              onClick={handleRunSql}
              disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play size={13} />
              <span>{loading ? "Ejecutando en D1..." : "Ejecutar SQL"}</span>
            </button>

            {/* Results Table */}
            {sqlResults && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
                  <span>{sqlResults.length} fila(s) retornada(s)</span>
                  {sqlMeta && <span>Tiempo: {sqlMeta.execution_time_ms} ms</span>}
                </div>

                <div className="overflow-x-auto max-h-96 border border-gray-800 rounded-lg bg-gray-950">
                  {sqlResults.length > 0 ? (
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-gray-900 border-b border-gray-800 text-gray-400 sticky top-0">
                        <tr>
                          {Object.keys(sqlResults[0]).map((col) => (
                            <th key={col} className="p-2.5 font-semibold">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {sqlResults.map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-800/40">
                            {Object.values(row).map((val: any, cidx) => (
                              <td key={cidx} className="p-2.5 text-gray-300 truncate max-w-xs">
                                {val !== null ? String(val) : "NULL"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-xs text-gray-500">Consulta ejecutada con éxito (0 resultados).</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 6: AUDIT LOGS */}
        {/* =================================================================== */}
        {activeTab === "audit" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Database size={18} className="text-purple-400" />
              <span>Registro Central de Seguridad y Auditoría (Últimos 100 eventos)</span>
            </h3>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="pb-3 font-semibold">Tipo de Evento</th>
                    <th className="pb-3 font-semibold">Clave / Licencia</th>
                    <th className="pb-3 font-semibold">IP</th>
                    <th className="pb-3 font-semibold">Detalles</th>
                    <th className="pb-3 font-semibold">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-800/30">
                      <td className="py-2.5 text-indigo-300 font-bold">{log.event_type}</td>
                      <td className="py-2.5 text-gray-300">{log.license_key || "—"}</td>
                      <td className="py-2.5 text-gray-500">{log.ip_address || "0.0.0.0"}</td>
                      <td className="py-2.5 text-gray-400 truncate max-w-md">{log.details_json}</td>
                      <td className="py-2.5 text-gray-500">{log.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
