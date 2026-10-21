/**
 * WPipe Studio - Super-Admin Web Console (Pro-Max Edition)
 * Deployed at: admin.wisrovi.dev (Cloudflare Pages at 0 €/month)
 * Complete Administrative Sovereignty: D1 SQL Console with Dynamic Schema Explorer,
 * VIP/Partner License Minter, Accordion Lease Inspector, CSV/JSON Exporters, & Edge Telemetry.
 * Author: William Rodriguez (wisrovi.dev)
 */

import React, { useState, useEffect, useMemo } from "react";
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
  Download,
  ChevronDown,
  ChevronRight,
  Edit3,
  Trash2,
  Server,
  FileText,
  Table,
  HelpCircle,
  Send,
  Zap,
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

interface TableColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface TableSchemaInfo {
  name: string;
  rowCount: number;
  columns: TableColumn[];
}

export default function App() {
  const [masterKey, setMasterKey] = useState<string>(() => localStorage.getItem("wpipe_admin_master_token") || "");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"overview" | "licenses" | "vip_minter" | "leases" | "sql_console" | "audit">("overview");

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Telemetry & Health State
  const [pingData, setPingData] = useState<{ latency_ms: number; edge_colo: string; status: string } | null>(null);

  // Module States
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [expandedLicenseId, setExpandedLicenseId] = useState<string | null>(null);
  const [editingLicense, setEditingLicense] = useState<LicenseRecord | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("" );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");

  // VIP Minter State
  const [vipName, setVipName] = useState<string>("");
  const [vipEmail, setVipEmail] = useState<string>("");
  const [vipPlan, setVipPlan] = useState<string>("enterprise");
  const [vipSeats, setVipSeats] = useState<number>(5);
  const [vipDuration, setVipDuration] = useState<string>("365");
  const [vipCustomKey, setVipCustomKey] = useState<string>("");
  const [vipResult, setVipResult] = useState<any>(null);

  // Leases State
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [leaseSearch, setLeaseSearch] = useState<string>("");

  // SQL Console & Dynamic Schema Explorer
  const [sqlQuery, setSqlQuery] = useState<string>(
    "SELECT id, license_key, admin_key, plan, max_seats, status, customer_email FROM licenses ORDER BY created_at DESC LIMIT 25;"
  );
  const [sqlResults, setSqlResults] = useState<any[] | null>(null);
  const [sqlMeta, setSqlMeta] = useState<any>(null);
  const [schemaTables, setSchemaTables] = useState<TableSchemaInfo[]>([]);
  const [loadingSchema, setLoadingSchema] = useState<boolean>(false);
  const [expandedSchemaTable, setExpandedSchemaTable] = useState<string | null>(null);
  const [selectedPresetCategory, setSelectedPresetCategory] = useState<string>("metrics");

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>("");

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
      throw new Error(err.message || "Error al ejecutar consulta en Cloudflare D1.");
    }
    return res.json();
  };

  // Ping Telemetry
  const checkPing = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/admin/system/ping`, {
        headers: { Authorization: `Bearer ${masterKey}` },
      });
      if (res.ok) {
        const json = await res.json();
        setPingData(json);
      }
    } catch {}
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
      loadSchemaExplorer(keyToVerify);
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
  };

  // Initial Data Fetcher
  const fetchInitialData = async (token = masterKey) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Stats
      const statsRes = await fetch(`${API_BASE}/v1/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // 2. Fetch Licenses
      const licData = await executeSql(
        "SELECT id, license_key, admin_key, customer_name, customer_email, plan, status, max_seats, expires_at, created_at FROM licenses ORDER BY created_at DESC"
      );
      setLicenses(licData.results || []);

      // 3. Fetch Leases
      const leaseData = await executeSql(
        `SELECT le.id, le.license_id, le.machine_fingerprint, le.hostname, le.os_name, 
                le.last_heartbeat_at, le.lease_expires_at, le.created_at,
                li.license_key, li.customer_email
         FROM leases le
         LEFT JOIN licenses li ON le.license_id = li.id
         ORDER BY le.lease_expires_at DESC`
      );
      setLeases(leaseData.results || []);

      checkPing();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load Database Schema Dynamically
  const loadSchemaExplorer = async (token = masterKey) => {
    setLoadingSchema(true);
    try {
      const tablesRes = await fetch(`${API_BASE}/v1/admin/sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY name ASC;",
        }),
      });
      const tablesJson = await tablesRes.json();
      const tableList = tablesJson.results || [];

      const fullSchema: TableSchemaInfo[] = [];
      for (const t of tableList) {
        const tableName = t.name;
        const [infoRes, countRes] = await Promise.all([
          fetch(`${API_BASE}/v1/admin/sql`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ sql: `PRAGMA table_info(${tableName});` }),
          }),
          fetch(`${API_BASE}/v1/admin/sql`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ sql: `SELECT count(*) as count FROM ${tableName};` }),
          }),
        ]);

        const infoJson = await infoRes.json().catch(() => ({ results: [] }));
        const countJson = await countRes.json().catch(() => ({ results: [{ count: 0 }] }));

        fullSchema.push({
          name: tableName,
          rowCount: countJson.results?.[0]?.count || 0,
          columns: infoJson.results || [],
        });
      }
      setSchemaTables(fullSchema);
    } catch (e) {
      console.error("Error loading D1 schema:", e);
    } finally {
      setLoadingSchema(false);
    }
  };

  // Save License Edits
  const handleSaveLicenseEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLicense) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/admin/licenses/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
        body: JSON.stringify({
          license_id: editingLicense.id,
          status: editingLicense.status,
          max_seats: editingLicense.max_seats,
          plan: editingLicense.plan,
          expires_at: editingLicense.expires_at || null,
        }),
      });
      if (!res.ok) throw new Error("Error al actualizar licencia.");
      setSuccessNotice(`Licencia ${editingLicense.license_key} actualizada correctamente.`);
      setTimeout(() => setSuccessNotice(null), 3000);
      setEditingLicense(null);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle License Status Quick
  const toggleLicenseStatus = async (licenseId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "active" ? "suspended" : "active";
    setLoading(true);
    try {
      await fetch(`${API_BASE}/v1/admin/licenses/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
        body: JSON.stringify({ license_id: licenseId, status: nextStatus }),
      });
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Adjust Seats Quick
  const adjustSeats = async (licenseId: string, currentSeats: number, delta: number) => {
    const nextSeats = Math.max(1, currentSeats + delta);
    setLoading(true);
    try {
      await fetch(`${API_BASE}/v1/admin/licenses/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
        body: JSON.stringify({ license_id: licenseId, max_seats: nextSeats }),
      });
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Mint VIP License with Duration Preset
  const handleMintVip = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setVipResult(null);

    let calculatedExpiresAt: string | null = null;
    if (vipDuration !== "permanent") {
      const days = parseInt(vipDuration, 10) || 365;
      const d = new Date();
      d.setDate(d.getDate() + days);
      calculatedExpiresAt = d.toISOString();
    }

    try {
      const res = await fetch(`${API_BASE}/v1/admin/licenses/vip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${masterKey}`,
        },
        body: JSON.stringify({
          customer_name: vipName.trim() || "VIP Partner",
          customer_email: vipEmail.trim() || "partner@wisrovi.dev",
          plan: vipPlan,
          max_seats: vipSeats,
          custom_key: vipCustomKey.trim() || undefined,
          expires_at: calculatedExpiresAt,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al acuñar licencia VIP.");

      setVipResult(json);
      setSuccessNotice(`¡Licencia VIP creada con éxito para ${json.customer_name || "Socio"}!`);
      setTimeout(() => setSuccessNotice(null), 5000);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Kick Specific Lease
  const handleKickLease = async (leaseId: string) => {
    if (!confirm("¿Seguro que deseas expulsar este puesto? Se desconectará de inmediato.")) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/v1/admin/leases/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
        body: JSON.stringify({ lease_id: leaseId }),
      });
      setSuccessNotice("Puesto expulsado con éxito.");
      setTimeout(() => setSuccessNotice(null), 3000);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Purge Expired Leases
  const handlePurgeExpiredLeases = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/admin/leases/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
      });
      const json = await res.json();
      setSuccessNotice(`Purga completada: ${json.purged_count || 0} puestos expirados liberados.`);
      setTimeout(() => setSuccessNotice(null), 3000);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Run Custom SQL Query
  const handleRunSql = async () => {
    if (!sqlQuery.trim()) return;
    setLoading(true);
    setError(null);
    setSqlResults(null);
    setSqlMeta(null);

    try {
      const data = await executeSql(sqlQuery);
      setSqlResults(data.results || []);
      setSqlMeta(data.meta || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs
  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const data = await executeSql(
        "SELECT id, event_type, license_key, ip_address, details_json, created_at FROM audit_logs ORDER BY id DESC LIMIT 100"
      );
      setAuditLogs(data.results || []);
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

  // Export Data to CSV
  const exportToCsv = (dataToExport: any[], filename = "export.csv") => {
    if (!dataToExport || dataToExport.length === 0) return;
    const headers = Object.keys(dataToExport[0]);
    const csvRows = [
      headers.join(","),
      ...dataToExport.map((row) =>
        headers
          .map((fieldName) => {
            const val = row[fieldName];
            const escaped = (val === null || val === undefined ? "" : String(val)).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Data to JSON
  const exportToJson = (dataToExport: any[], filename = "export.json") => {
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Licenses
  const filteredLicenses = useMemo(() => {
    return licenses.filter((lic) => {
      const matchesSearch =
        searchQuery === "" ||
        lic.license_key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lic.customer_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lic.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lic.admin_key && lic.admin_key.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === "all" || lic.status === statusFilter;
      const matchesPlan = planFilter === "all" || lic.plan === planFilter;
      return matchesSearch && matchesStatus && matchesPlan;
    });
  }, [licenses, searchQuery, statusFilter, planFilter]);

  // Filtered Leases
  const filteredLeases = useMemo(() => {
    return leases.filter((le) => {
      if (!leaseSearch.trim()) return true;
      const term = leaseSearch.toLowerCase();
      return (
        (le.hostname && le.hostname.toLowerCase().includes(term)) ||
        (le.os_name && le.os_name.toLowerCase().includes(term)) ||
        (le.customer_email && le.customer_email.toLowerCase().includes(term)) ||
        (le.license_key && le.license_key.toLowerCase().includes(term)) ||
        le.machine_fingerprint.toLowerCase().includes(term)
      );
    });
  }, [leases, leaseSearch]);

  // Filtered Audit Logs
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (!auditSearch.trim()) return true;
      const term = auditSearch.toLowerCase();
      return (
        log.event_type.toLowerCase().includes(term) ||
        (log.license_key && log.license_key.toLowerCase().includes(term)) ||
        (log.ip_address && log.ip_address.toLowerCase().includes(term)) ||
        (log.details_json && log.details_json.toLowerCase().includes(term))
      );
    });
  }, [auditLogs, auditSearch]);

  // Categorized Presets Library
  const sqlPresets = [
    {
      category: "metrics",
      title: "Distribución por Plan",
      desc: "Conteo de licencias y suma de puestos contratados por cada plan.",
      sql: "SELECT plan, count(*) as licencias, sum(max_seats) as puestos_totales FROM licenses GROUP BY plan ORDER BY puestos_totales DESC;",
    },
    {
      category: "metrics",
      title: "Ocupación Global de Asientos",
      desc: "Puestos activos conectados ahora mismo vs cupo total contratado.",
      sql: "SELECT (SELECT count(*) FROM leases WHERE lease_expires_at > datetime('now')) as puestos_activos, (SELECT sum(max_seats) FROM licenses WHERE status='active') as puestos_contratados;",
    },
    {
      category: "metrics",
      title: "Top 10 Organizaciones por Cupo",
      desc: "Empresas con mayor número de puestos asignados.",
      sql: "SELECT customer_name, customer_email, plan, max_seats, status, created_at FROM licenses ORDER BY max_seats DESC LIMIT 10;",
    },
    {
      category: "audit",
      title: "Últimos 50 Eventos de Auditoría",
      desc: "Traza de auditoría de actividad reciente y webhooks.",
      sql: "SELECT id, event_type, license_key, ip_address, created_at FROM audit_logs ORDER BY id DESC LIMIT 50;",
    },
    {
      category: "audit",
      title: "Códigos OTP Generados Recientes",
      desc: "Últimos 20 códigos OTP enviados con estado de uso y expiración.",
      sql: "SELECT id, email, attempts, used, expires_at, created_at FROM otp_codes ORDER BY created_at DESC LIMIT 20;",
    },
    {
      category: "audit",
      title: "Sistemas Operativos Conectados",
      desc: "Desglose de puestos flotantes por plataforma (Linux, Windows, macOS).",
      sql: "SELECT coalesce(os_name, 'Desconocido') as sistema_operativo, count(*) as maquinas_activas FROM leases GROUP BY os_name ORDER BY maquinas_activas DESC;",
    },
    {
      category: "maintenance",
      title: "Licencias Caducadas",
      desc: "Licencias con fecha de expiración menor a la fecha actual.",
      sql: "SELECT id, license_key, customer_email, expires_at, status FROM licenses WHERE expires_at IS NOT NULL AND expires_at < datetime('now');",
    },
    {
      category: "maintenance",
      title: "Leases Vencidos Pendientes de Purgar",
      desc: "Puestos cuyo heartbeat expiró y pueden ser liberados.",
      sql: "SELECT id, license_id, hostname, os_name, lease_expires_at FROM leases WHERE lease_expires_at <= datetime('now');",
    },
    {
      category: "maintenance",
      title: "Licencias Huérfanas (Sin puestos conectados)",
      desc: "Licencias activas que no tienen ninguna máquina conectada actualmente.",
      sql: "SELECT l.id, l.license_key, l.customer_email, l.plan, l.max_seats FROM licenses l LEFT JOIN leases le ON l.id = le.license_id WHERE le.id IS NULL AND l.status = 'active';",
    },
  ];

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
            <p className="text-xs text-indigo-300 font-mono mt-1">
              Super-Admin Cockpit &bull; Sovereignty Console
            </p>
            <p className="text-[11px] text-gray-400 mt-2">
              Acceso restringido para William Rodriguez (Cloudflare D1 Authority).
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
              {loading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Verificando...</span>
                </>
              ) : (
                <>
                  <Shield size={14} />
                  <span>Acceder al Panel Maestro</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-gray-800 text-center text-[10px] text-gray-500">
            Cloudflare Workers &bull; D1 Distributed SQLite &bull; Coste: 0 &euro;/mes
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW: Main Authenticated Dashboard
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#07090e] text-gray-100 flex flex-col font-sans">
      {/* Top Cockpit Header */}
      <header className="border-b border-gray-800/80 bg-[#0c1220]/90 backdrop-blur-md px-6 py-3 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 via-purple-600 to-pink-600 flex items-center justify-center font-black text-white text-sm shadow-md">
            🛡️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base tracking-tight text-white">
                WPipe Studio Super-Admin
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono font-bold">
                PRO-MAX SOVEREIGN
              </span>
            </div>
            <p className="text-[10px] text-gray-400">
              William Rodriguez &bull; Cloudflare D1 Authority &bull;{" "}
              {pingData ? (
                <span className="text-emerald-400 font-mono">
                  {pingData.edge_colo} ({pingData.latency_ms}ms) &bull; Healthy
                </span>
              ) : (
                <span className="text-gray-500">Conectando...</span>
              )}
            </p>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <div className="flex items-center bg-gray-900/90 border border-gray-800 rounded-lg p-1 text-xs font-medium">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "overview"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Activity size={13} />
            <span>Cockpit</span>
          </button>

          <button
            onClick={() => setActiveTab("licenses")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "licenses"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Users size={13} />
            <span>Licencias ({licenses.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("vip_minter")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "vip_minter"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Sparkles size={13} />
            <span>Minador VIP</span>
          </button>

          <button
            onClick={() => setActiveTab("leases")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "leases"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Laptop size={13} />
            <span>Puestos Flotantes ({leases.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("sql_console")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "sql_console"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Database size={13} />
            <span>Consola SQL D1</span>
          </button>

          <button
            onClick={() => setActiveTab("audit")}
            className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              activeTab === "audit"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Terminal size={13} />
            <span>Auditoría</span>
          </button>
        </div>

        {/* Refresh & Logout Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchInitialData()}
            disabled={loading}
            className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer border border-gray-700/60"
            title="Recargar datos"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>

          <button
            onClick={handleLogout}
            className="py-1.5 px-3 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer font-medium"
          >
            <LogOut size={13} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* Global Alerts & Notices */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-950/80 border border-red-700/80 rounded-xl text-xs text-red-200 flex items-start gap-2 shadow-lg">
          <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white font-bold">
            &times;
          </button>
        </div>
      )}

      {successNotice && (
        <div className="mx-6 mt-4 p-3 bg-emerald-950/80 border border-emerald-700/80 rounded-xl text-xs text-emerald-200 flex items-start gap-2 shadow-lg">
          <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">{successNotice}</div>
          <button onClick={() => setSuccessNotice(null)} className="text-emerald-400 hover:text-white font-bold">
            &times;
          </button>
        </div>
      )}

      {/* Main Content Body */}
      <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* =================================================================== */}
        {/* TAB 1: OVERVIEW / COCKPIT */}
        {/* =================================================================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-xl">
                  <Shield size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Total Licencias</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.total_licenses ?? licenses.length}
                  </div>
                  <span className="text-[10px] text-indigo-400 font-mono">
                    {stats?.active_licenses ?? 0} activas en producción
                  </span>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-xl">
                  <Laptop size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Puestos Flotantes en Vivo</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.active_floating_leases ?? leases.length}
                  </div>
                  <span className="text-[10px] text-purple-400 font-mono">Máquinas conectadas hoy</span>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 text-xl">
                  <Terminal size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Auditoría (Últimos 7 días)</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.recent_audit_events_7d ?? 0}
                  </div>
                  <span className="text-[10px] text-pink-400 font-mono">Eventos de seguridad & webhooks</span>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl">
                  <Server size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Infraestructura Serverless</span>
                  <div className="text-2xl font-black text-emerald-400 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>100% Online</span>
                  </div>
                  <span className="text-[10px] text-emerald-500/90 font-mono">
                    Cloudflare D1 &bull; 0 &euro;/mes
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* VIP Minter Quick Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles size={18} />
                  <h3 className="font-bold text-sm text-white">Minador VIP Directo</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  ¿Necesitas generar una licencia para un inversor, partner o universidad sin pasar por Lemon Squeezy?
                </p>
                <button
                  onClick={() => setActiveTab("vip_minter")}
                  className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} />
                  <span>Abrir Minador de Licencias</span>
                </button>
              </div>

              {/* D1 SQL Console Quick Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-purple-400">
                  <Database size={18} />
                  <h3 className="font-bold text-sm text-white">Explorador SQL & Tablas</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Inspecciona las 5 tablas de Cloudflare D1 en tiempo real con el explorador dinámico de esquemas y presets.
                </p>
                <button
                  onClick={() => setActiveTab("sql_console")}
                  className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Database size={14} />
                  <span>Lanzar Consola SQL</span>
                </button>
              </div>

              {/* Maintenance & Telemetry Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-pink-400">
                  <Zap size={18} />
                  <h3 className="font-bold text-sm text-white">Mantenimiento de Leases</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Purga en 1 solo clic los leases expirados que ya no envían heartbeat para liberar cupos de clientes.
                </p>
                <button
                  onClick={handlePurgeExpiredLeases}
                  disabled={loading}
                  className="w-full py-2 px-4 bg-gray-800 hover:bg-gray-700 text-pink-300 border border-pink-900/60 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} />
                  <span>Purgar Leases Expirados</span>
                </button>
              </div>
            </div>

            {/* Recent Connected Stations Snapshot */}
            <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Laptop size={18} className="text-indigo-400" />
                  <h3 className="font-bold text-sm text-white">Puestos Flotantes Recientes Conectados</h3>
                </div>
                <button
                  onClick={() => setActiveTab("leases")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <span>Ver todos ({leases.length})</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="pb-2 font-medium">Equipo / Hostname</th>
                      <th className="pb-2 font-medium">SO</th>
                      <th className="pb-2 font-medium">Cliente / Licencia</th>
                      <th className="pb-2 font-medium">Último Heartbeat</th>
                      <th className="pb-2 font-medium text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60 font-mono">
                    {leases.slice(0, 5).map((le) => (
                      <tr key={le.id} className="hover:bg-gray-800/30">
                        <td className="py-2.5 text-white font-bold">{le.hostname || "station-unknown"}</td>
                        <td className="py-2.5 text-gray-300">{le.os_name || "Linux"}</td>
                        <td className="py-2.5 text-gray-400">{le.customer_email || le.license_key}</td>
                        <td className="py-2.5 text-gray-400">{new Date(le.last_heartbeat_at).toLocaleTimeString()}</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleKickLease(le.id)}
                            className="px-2 py-0.5 bg-red-950 hover:bg-red-900 text-red-300 rounded text-[10px] cursor-pointer"
                          >
                            Expulsar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {leases.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-gray-500 font-sans">
                          No hay puestos flotantes conectados en este momento.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: ADVANCED LICENSE MANAGER (ACCORDION & EDIT MODAL) */}
        {/* =================================================================== */}
        {activeTab === "licenses" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
            {/* Filter and Action Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search size={14} className="absolute left-3 top-3 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por correo, nombre o clave..."
                    className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none"
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activas</option>
                  <option value="suspended">Suspendidas</option>
                  <option value="expired">Expiradas</option>
                </select>

                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none"
                >
                  <option value="all">Todos los planes</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="vip">VIP / Partner</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportToCsv(filteredLicenses, "wpipe_licenses.csv")}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
                >
                  <Download size={13} />
                  <span>Exportar CSV</span>
                </button>

                <button
                  onClick={() => setActiveTab("vip_minter")}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles size={13} />
                  <span>+ Acuñar Licencia VIP</span>
                </button>
              </div>
            </div>

            {/* Licenses Table with Accordion Leases */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 font-medium">
                    <th className="pb-3 w-8"></th>
                    <th className="pb-3">Clave de Puesto (VS Code)</th>
                    <th className="pb-3">Clave Admin Privada</th>
                    <th className="pb-3">Cliente / Correo</th>
                    <th className="pb-3">Plan</th>
                    <th className="pb-3 text-center">Puestos</th>
                    <th className="pb-3 text-center">Estado</th>
                    <th className="pb-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {filteredLicenses.map((lic) => {
                    const isExpanded = expandedLicenseId === lic.id;
                    const connectedLeases = leases.filter((l) => l.license_id === lic.id);

                    return (
                      <React.Fragment key={lic.id}>
                        <tr className="hover:bg-gray-800/30 transition">
                          <td className="py-3 text-center">
                            <button
                              onClick={() => setExpandedLicenseId(isExpanded ? null : lic.id)}
                              className="text-gray-500 hover:text-indigo-400 cursor-pointer"
                              title="Ver puestos conectados"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>

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
                            <div className="truncate max-w-[190px]">
                              <span className="font-semibold block text-white truncate">
                                {lic.customer_name || "Sin nombre"}
                              </span>
                              <span className="text-gray-400 text-[11px] truncate block">
                                {lic.customer_email}
                              </span>
                            </div>
                          </td>

                          <td className="py-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-800 text-gray-300 border border-gray-700">
                              {lic.plan}
                            </span>
                          </td>

                          <td className="py-3 text-center">
                            <div className="inline-flex items-center gap-1 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                              <button
                                onClick={() => adjustSeats(lic.id, lic.max_seats, -1)}
                                className="text-gray-400 hover:text-white px-1 font-bold cursor-pointer"
                              >
                                -
                              </button>
                              <span className="text-white font-bold px-1">{lic.max_seats}</span>
                              <button
                                onClick={() => adjustSeats(lic.id, lic.max_seats, 1)}
                                className="text-gray-400 hover:text-white px-1 font-bold cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                            <span className="block text-[9px] text-gray-500 mt-0.5">
                              {connectedLeases.length} en uso
                            </span>
                          </td>

                          <td className="py-3 text-center">
                            <button
                              onClick={() => toggleLicenseStatus(lic.id, lic.status)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer border ${
                                lic.status === "active"
                                  ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                                  : "bg-amber-950 text-amber-400 border-amber-800"
                              }`}
                            >
                              {lic.status === "active" ? "Activa" : "Suspendida"}
                            </button>
                          </td>

                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingLicense(lic)}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded cursor-pointer"
                                title="Editar licencia"
                              >
                                <Edit3 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Accordion Drawer: Connected Leases */}
                        {isExpanded && (
                          <tr className="bg-gray-950/60">
                            <td colSpan={8} className="p-4 pl-12 border-b border-gray-800/80">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-gray-400 font-sans">
                                  <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                                    <Laptop size={13} />
                                    <span>Puestos actualmente ocupando esta licencia ({connectedLeases.length}/{lic.max_seats}):</span>
                                  </span>
                                </div>

                                {connectedLeases.length === 0 ? (
                                  <p className="text-gray-500 text-xs italic font-sans">
                                    Ninguna máquina conectada en este momento.
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {connectedLeases.map((le) => (
                                      <div
                                        key={le.id}
                                        className="bg-gray-900 border border-gray-800 p-2.5 rounded-lg flex items-center justify-between"
                                      >
                                        <div>
                                          <span className="text-white font-bold block">{le.hostname || "station"}</span>
                                          <span className="text-gray-400 text-[10px] block">
                                            {le.os_name || "Linux"} &bull; Heartbeat: {new Date(le.last_heartbeat_at).toLocaleTimeString()}
                                          </span>
                                        </div>
                                        <button
                                          onClick={() => handleKickLease(le.id)}
                                          className="px-2 py-1 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded text-[10px] cursor-pointer"
                                        >
                                          Expulsar
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Modal: Full License Editor */}
            {editingLicense && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#0f172a] border border-indigo-700/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                    <h3 className="font-bold text-white text-sm flex items-center gap-2">
                      <Edit3 size={15} className="text-indigo-400" />
                      <span>Editar Licencia: {editingLicense.license_key}</span>
                    </h3>
                    <button
                      onClick={() => setEditingLicense(null)}
                      className="text-gray-400 hover:text-white font-bold text-base"
                    >
                      &times;
                    </button>
                  </div>

                  <form onSubmit={handleSaveLicenseEdit} className="space-y-3 text-xs">
                    <div>
                      <label className="text-gray-400 block mb-1">Cliente</label>
                      <input
                        type="text"
                        disabled
                        value={`${editingLicense.customer_name} (${editingLicense.customer_email})`}
                        className="w-full px-3 py-2 bg-gray-900/60 border border-gray-800 rounded text-gray-400 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-gray-300 block mb-1">Estado</label>
                        <select
                          value={editingLicense.status}
                          onChange={(e) => setEditingLicense({ ...editingLicense, status: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                        >
                          <option value="active">active (Activa)</option>
                          <option value="suspended">suspended (Suspendida)</option>
                          <option value="expired">expired (Expirada)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-gray-300 block mb-1">Plan</label>
                        <select
                          value={editingLicense.plan}
                          onChange={(e) => setEditingLicense({ ...editingLicense, plan: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                        >
                          <option value="starter">Starter</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                          <option value="vip">VIP</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-gray-300 block mb-1">Asientos Máximos (Floating Seats)</label>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={editingLicense.max_seats}
                        onChange={(e) =>
                          setEditingLicense({ ...editingLicense, max_seats: parseInt(e.target.value, 10) || 1 })
                        }
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-gray-300 block mb-1">Fecha de Expiración (ISO / Vacío = Permanente)</label>
                      <input
                        type="text"
                        value={editingLicense.expires_at || ""}
                        onChange={(e) => setEditingLicense({ ...editingLicense, expires_at: e.target.value || null })}
                        placeholder="Ej. 2027-12-31T23:59:59Z o dejar vacío"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white font-mono"
                      />
                    </div>

                    <div className="pt-3 flex items-center justify-end gap-2 border-t border-gray-800">
                      <button
                        type="button"
                        onClick={() => setEditingLicense(null)}
                        className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-medium cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition cursor-pointer"
                      >
                        Guardar Cambios
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: PRO VIP & PARTNER MINTER */}
        {/* =================================================================== */}
        {activeTab === "vip_minter" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: What is VIP Minter explanation card */}
            <div className="bg-[#0f172a] border border-indigo-900/60 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-indigo-400">
                <HelpCircle size={20} />
                <h3 className="font-extrabold text-base text-white">¿Qué hace el Minador VIP?</h3>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                El flujo estándar de WPipe Studio cobra a través de **Lemon Squeezy** con tarjeta de crédito y crea la licencia vía webhooks automáticos.
              </p>
              <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-xl space-y-2 text-xs text-indigo-200">
                <span className="font-bold block text-white">🎯 Casos de Uso Soberano:</span>
                <ul className="list-disc list-inside space-y-1 text-gray-300 text-[11px]">
                  <li><strong>Partners Comerciales:</strong> Convenios B2B donde la facturación va por factura bancaria.</li>
                  <li><strong>Universidades & Aceleradoras:</strong> Donación de cupos de 50 asientos para formación.</li>
                  <li><strong>Influencers & Embajadores:</strong> Licencias gratuitas para difusión en redes.</li>
                  <li><strong>Tus Propios Equipos:</strong> Licencias master con puestos ilimitados para desarrollo.</li>
                </ul>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Genera firmas Ed25519 en D1 idénticas a las comerciales, asignando además una <strong>Clave de Administración privada</strong> para el socio.
              </p>
            </div>

            {/* Middle: Minting Form */}
            <div className="lg:col-span-2 bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles size={16} className="text-purple-400" />
                    <span>Acuñador de Licencias VIP & Partners</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Emisión criptográfica instantánea en Cloudflare D1.
                  </p>
                </div>
              </div>

              <form onSubmit={handleMintVip} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Nombre del Socio / Organización</label>
                    <input
                      type="text"
                      value={vipName}
                      onChange={(e) => setVipName(e.target.value)}
                      placeholder="Ej. eCaptureDtech / Universidad de Extremadura"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Correo de Contacto</label>
                    <input
                      type="email"
                      value={vipEmail}
                      onChange={(e) => setVipEmail(e.target.value)}
                      placeholder="socio@partner.com"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Nivel de Plan</label>
                    <select
                      value={vipPlan}
                      onChange={(e) => setVipPlan(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                    >
                      <option value="pro">Pro ($29/mo tier)</option>
                      <option value="enterprise">Enterprise ($99/mo tier)</option>
                      <option value="unlimited-vip">Unlimited VIP (Sin límites)</option>
                      <option value="academic">Academic / Education</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Puestos Concurrentes (Seats)</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={vipSeats}
                      onChange={(e) => setVipSeats(parseInt(e.target.value, 10) || 1)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono font-bold"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Validez / Expiración</label>
                    <select
                      value={vipDuration}
                      onChange={(e) => setVipDuration(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                    >
                      <option value="30">30 Días (Demo Comercial)</option>
                      <option value="90">90 Días (Trimestral)</option>
                      <option value="365">1 Año (Anual Partner)</option>
                      <option value="permanent">Permanente (De por vida)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-300 font-medium mb-1 flex items-center justify-between">
                    <span>Clave Personalizada (Opcional)</span>
                    <span className="text-[10px] text-gray-500 font-mono">Dejar vacío para autogenerar</span>
                  </label>
                  <input
                    type="text"
                    value={vipCustomKey}
                    onChange={(e) => setVipCustomKey(e.target.value)}
                    placeholder="WPIPE-PARTNER-XXXX..."
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono uppercase"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-600 hover:from-indigo-400 hover:to-pink-500 text-white font-bold rounded-lg transition shadow-lg shadow-indigo-500/20 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} />
                  <span>{loading ? "Acuñando en Cloudflare D1..." : "Acuñar y Registrar Licencia Oficial"}</span>
                </button>
              </form>

              {/* Minter Output & Email Generator */}
              {vipResult && (
                <div className="mt-4 p-4 bg-purple-950/40 border border-purple-800 rounded-xl space-y-4">
                  <div className="flex items-center gap-2 text-purple-300 font-bold">
                    <CheckCircle2 size={16} />
                    <span>¡Licencia Acuñada y Activa en Cloudflare D1!</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                    <div className="bg-gray-900/90 p-3 rounded-lg border border-gray-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-gray-400 block">Clave de Puesto (VS Code):</span>
                        <strong className="text-white text-sm">{vipResult.license_key}</strong>
                      </div>
                      <button
                        onClick={() => handleCopy(vipResult.license_key)}
                        className="px-2.5 py-1 bg-purple-900 hover:bg-purple-800 text-purple-200 rounded text-[11px] cursor-pointer"
                      >
                        {copiedKey === vipResult.license_key ? "¡Copiado!" : "Copiar"}
                      </button>
                    </div>

                    <div className="bg-gray-900/90 p-3 rounded-lg border border-gray-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-gray-400 block">Clave de Administración (Privada):</span>
                        <strong className="text-purple-300 text-sm">{vipResult.admin_key}</strong>
                      </div>
                      <button
                        onClick={() => handleCopy(vipResult.admin_key)}
                        className="px-2.5 py-1 bg-purple-900 hover:bg-purple-800 text-purple-200 rounded text-[11px] cursor-pointer"
                      >
                        {copiedKey === vipResult.admin_key ? "¡Copiado!" : "Copiar"}
                      </button>
                    </div>
                  </div>

                  {/* Ready to send email template */}
                  <div className="p-3 bg-gray-900/90 rounded-lg border border-gray-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-300 font-sans font-bold flex items-center gap-1.5">
                        <Send size={12} className="text-purple-400" />
                        <span>Plantilla de Correo para el Socio (Listo para enviar):</span>
                      </span>
                      <button
                        onClick={() => {
                          const emailText = `Hola ${vipName || "Socio"},\n\nAquí tienes tu licencia oficial de WPipe Studio (${vipResult.plan.toUpperCase()} - ${vipResult.max_seats} puestos):\n\n- Clave de Activación (VS Code): ${vipResult.license_key}\n- Clave de Administración Privada: ${vipResult.admin_key}\n- Portal de Autoservicio: https://portal.wisrovi.dev\n\nPara activar en terminal:\nwpipe-engine activate --key ${vipResult.license_key}\n\nUn cordial saludo,\nWilliam Rodriguez - wisrovi.dev`;
                          handleCopy(emailText);
                        }}
                        className="text-[10px] text-purple-300 hover:text-white cursor-pointer"
                      >
                        {copiedKey?.includes("Hola") ? "¡Plantilla Copiada!" : "Copiar Correo Completo"}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap bg-gray-950 p-2.5 rounded border border-gray-800/60 leading-relaxed">
{`Hola ${vipName || "Socio"},

Aquí tienes tu licencia oficial de WPipe Studio (${vipResult.plan.toUpperCase()} - ${vipResult.max_seats} puestos):

- Clave de Activación (VS Code): ${vipResult.license_key}
- Clave de Administración Privada: ${vipResult.admin_key}
- Portal de Autoservicio: https://portal.wisrovi.dev

Para activar en terminal:
wpipe-engine activate --key ${vipResult.license_key}

Un cordial saludo,
William Rodriguez - wisrovi.dev`}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: FLOATING LEASES MONITOR */}
        {/* =================================================================== */}
        {activeTab === "leases" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Laptop size={18} className="text-indigo-400" />
                  <span>Monitor en Vivo de Puestos Flotantes (Floating Leases)</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Estaciones de trabajo ejecutando pipelines activas en el mundo. Heartbeat cada 30 min.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-2.5 text-gray-500" />
                  <input
                    type="text"
                    value={leaseSearch}
                    onChange={(e) => setLeaseSearch(e.target.value)}
                    placeholder="Filtrar por hostname, SO o hash..."
                    className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white"
                  />
                </div>

                <button
                  onClick={handlePurgeExpiredLeases}
                  className="px-3 py-1.5 bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  <span>Purgar Expirados</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 font-medium">
                    <th className="pb-3">Licencia Asociada</th>
                    <th className="pb-3">Hostname</th>
                    <th className="pb-3">SO</th>
                    <th className="pb-3">Huella de Máquina (SHA-256)</th>
                    <th className="pb-3">Último Heartbeat</th>
                    <th className="pb-3">Expira</th>
                    <th className="pb-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {filteredLeases.map((le) => (
                    <tr key={le.id} className="hover:bg-gray-800/30 transition">
                      <td className="py-3 text-sky-400">{le.license_key || le.license_id}</td>
                      <td className="py-3 text-white font-bold">{le.hostname || "station"}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700 text-[10px]">
                          {le.os_name || "Linux"}
                        </span>
                      </td>
                      <td className="py-3 text-gray-500 text-[11px] truncate max-w-[150px]">
                        {le.machine_fingerprint}
                      </td>
                      <td className="py-3 text-gray-400">
                        {new Date(le.last_heartbeat_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 text-gray-400">
                        {new Date(le.lease_expires_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleKickLease(le.id)}
                          className="px-2.5 py-1 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded text-[11px] cursor-pointer"
                        >
                          Expulsar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredLeases.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-500 font-sans">
                        No hay puestos flotantes registrados que coincidan con la búsqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 5: D1 SQL CONSOLE WITH DYNAMIC SCHEMA EXPLORER & PRESETS */}
        {/* =================================================================== */}
        {activeTab === "sql_console" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left Column: Interactive Schema Explorer & Presets */}
            <div className="lg:col-span-1 space-y-4">
              {/* Database Schema Tree */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                  <span className="font-bold text-xs text-white flex items-center gap-1.5">
                    <Table size={14} className="text-indigo-400" />
                    <span>Tablas D1 ({schemaTables.length})</span>
                  </span>
                  <button
                    onClick={() => loadSchemaExplorer()}
                    disabled={loadingSchema}
                    className="text-gray-400 hover:text-white cursor-pointer text-[11px]"
                    title="Recargar tablas"
                  >
                    <RefreshCw size={11} className={loadingSchema ? "animate-spin" : ""} />
                  </button>
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {schemaTables.map((tbl) => {
                    const isExpanded = expandedSchemaTable === tbl.name;
                    return (
                      <div key={tbl.name} className="border border-gray-800/80 rounded-lg overflow-hidden bg-gray-900/40">
                        <div
                          onClick={() => setExpandedSchemaTable(isExpanded ? null : tbl.name)}
                          className="p-2 flex items-center justify-between cursor-pointer hover:bg-gray-800/60 transition text-xs"
                        >
                          <div className="flex items-center gap-1.5 font-mono text-indigo-300 font-semibold">
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <span>{tbl.name}</span>
                          </div>
                          <span className="text-[10px] text-gray-500 font-mono bg-gray-800 px-1.5 py-0.5 rounded">
                            {tbl.rowCount}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="p-2 bg-gray-950/70 border-t border-gray-800/60 space-y-2 text-[11px]">
                            <button
                              onClick={() =>
                                setSqlQuery(`SELECT * FROM ${tbl.name} ORDER BY 1 DESC LIMIT 25;`)
                              }
                              className="w-full text-left py-1 px-2 rounded bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 font-mono text-[10px] flex items-center justify-between cursor-pointer"
                            >
                              <span>⚡ SELECT * LIMIT 25</span>
                              <Play size={10} />
                            </button>

                            <div className="space-y-1 font-mono text-[10px] pt-1">
                              {tbl.columns.map((col) => (
                                <div
                                  key={col.name}
                                  onClick={() => setSqlQuery((prev) => `${prev} ${col.name}`)}
                                  className="flex items-center justify-between p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white cursor-pointer transition"
                                  title="Haz clic para insertar columna en la consulta"
                                >
                                  <span className="text-gray-300 font-semibold">{col.name}</span>
                                  <div className="flex items-center gap-1">
                                    {col.pk === 1 && (
                                      <span className="text-[9px] bg-amber-950 text-amber-400 px-1 rounded">PK</span>
                                    )}
                                    <span className="text-[9px] text-gray-500">{col.type}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Categorized Presets Library */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                  <span className="font-bold text-xs text-white flex items-center gap-1.5">
                    <FileText size={14} className="text-purple-400" />
                    <span>Consultas Predefinidas</span>
                  </span>
                </div>

                {/* Preset Category Switcher */}
                <div className="grid grid-cols-3 gap-1 bg-gray-900 p-1 rounded-lg text-[10px] font-semibold">
                  <button
                    onClick={() => setSelectedPresetCategory("metrics")}
                    className={`py-1 rounded text-center cursor-pointer ${
                      selectedPresetCategory === "metrics"
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Métricas
                  </button>
                  <button
                    onClick={() => setSelectedPresetCategory("audit")}
                    className={`py-1 rounded text-center cursor-pointer ${
                      selectedPresetCategory === "audit"
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Auditoría
                  </button>
                  <button
                    onClick={() => setSelectedPresetCategory("maintenance")}
                    className={`py-1 rounded text-center cursor-pointer ${
                      selectedPresetCategory === "maintenance"
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Limpieza
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {sqlPresets
                    .filter((p) => p.category === selectedPresetCategory)
                    .map((preset) => (
                      <div
                        key={preset.title}
                        onClick={() => setSqlQuery(preset.sql)}
                        className="p-2.5 rounded-lg border border-gray-800 hover:border-purple-600/60 bg-gray-900/60 hover:bg-gray-800/60 transition cursor-pointer space-y-1"
                      >
                        <span className="font-semibold text-xs text-purple-300 block">{preset.title}</span>
                        <p className="text-[10px] text-gray-400 leading-snug">{preset.desc}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Right Column: SQL Editor & Tabular Results */}
            <div className="lg:col-span-3 bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Database size={18} className="text-indigo-400" />
                    <span>Consola SQL Directa sobre Cloudflare D1</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Ejecución instantánea contra el clúster SQLite distribuido de Cloudflare.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunSql}
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-indigo-500/20 cursor-pointer flex items-center gap-1.5"
                  >
                    <Play size={13} />
                    <span>Ejecutar SQL</span>
                  </button>
                </div>
              </div>

              {/* Multi-line SQL Query Area */}
              <div>
                <textarea
                  rows={4}
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT * FROM licenses LIMIT 10;"
                  className="w-full p-3.5 bg-gray-950 border border-gray-700/80 rounded-xl text-xs font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent leading-relaxed"
                />
              </div>

              {/* Query Benchmark & Export Bar */}
              {sqlMeta && (
                <div className="flex items-center justify-between bg-gray-900/80 px-3.5 py-2 rounded-lg border border-gray-800 text-[11px] font-mono">
                  <div className="flex items-center gap-4 text-gray-400">
                    <span>
                      Tiempo: <strong className="text-emerald-400">{sqlMeta.duration ?? 0} ms</strong>
                    </span>
                    <span>
                      Filas: <strong className="text-white">{sqlResults?.length ?? 0}</strong>
                    </span>
                    <span>
                      Región: <strong className="text-purple-400">{sqlMeta.served_by_region || "GLOBAL"}</strong>
                    </span>
                  </div>

                  {sqlResults && sqlResults.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => exportToCsv(sqlResults, "d1_query_results.csv")}
                        className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 cursor-pointer font-sans"
                      >
                        <Download size={10} />
                        <span>CSV</span>
                      </button>
                      <button
                        onClick={() => exportToJson(sqlResults, "d1_query_results.json")}
                        className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 cursor-pointer font-sans"
                      >
                        <Download size={10} />
                        <span>JSON</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Results Tabular View */}
              {sqlResults && (
                <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-800 rounded-xl">
                  {sqlResults.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-xs">
                      La consulta se ejecutó con éxito pero no devolvió filas.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 text-gray-300">
                        <tr>
                          {Object.keys(sqlResults[0]).map((col) => (
                            <th key={col} className="p-2.5 font-semibold">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {sqlResults.map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-800/40">
                            {Object.values(row).map((val: any, cidx) => (
                              <td key={cidx} className="p-2.5 text-gray-300 truncate max-w-xs">
                                {val === null ? (
                                  <span className="text-gray-600">NULL</span>
                                ) : typeof val === "object" ? (
                                  JSON.stringify(val)
                                ) : (
                                  String(val)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 6: AUDIT LOGS */}
        {/* =================================================================== */}
        {activeTab === "audit" && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Terminal size={18} className="text-indigo-400" />
                  <span>Flujo de Auditoría & Webhooks de Lemon Squeezy</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Registro de eventos criptográficos, activaciones, liberaciones y compras.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-2.5 text-gray-500" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Filtrar por evento, IP o clave..."
                    className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white"
                  />
                </div>

                <button
                  onClick={() => exportToCsv(filteredAuditLogs, "wpipe_audit_logs.csv")}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Download size={13} />
                  <span>Exportar CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto border border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="p-3">ID</th>
                    <th className="p-3">Evento</th>
                    <th className="p-3">Clave de Licencia</th>
                    <th className="p-3">IP Origen</th>
                    <th className="p-3">Detalles JSON</th>
                    <th className="p-3">Fecha y Hora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-800/30">
                      <td className="p-3 text-gray-500">{log.id}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {log.event_type}
                        </span>
                      </td>
                      <td className="p-3 text-gray-300">{log.license_key || "—"}</td>
                      <td className="p-3 text-gray-400">{log.ip_address || "EDGE"}</td>
                      <td className="p-3 text-gray-400 text-[10px] truncate max-w-xs">{log.details_json}</td>
                      <td className="p-3 text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {filteredAuditLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500 font-sans">
                        No se encontraron registros de auditoría.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
