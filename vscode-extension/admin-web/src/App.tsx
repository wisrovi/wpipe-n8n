/**
 * WPipe Studio - Super-Admin Web Console (Pro-Max Enterprise Edition)
 * Deployed at: admin.wisrovi.dev (Cloudflare Pages at 0 €/month)
 * Sovereign Infrastructure Control: D1 Dynamic Schema Explorer, Query History,
 * Bulk Operations Bar, VS Code Deep Link & QR Minter, Sortable SQL Engine & NOC Auto-Refresh.
 * Author: William Rodriguez (wisrovi.dev)
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
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
  History,
  ArrowUpDown,
  CheckSquare,
  Square,
  Radio,
  QrCode,
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
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // NOC Auto-Refresh State
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off, 10, 30, 60
  const [refreshCountdown, setRefreshCountdown] = useState<number>(0);
  const timerRef = useRef<any>(null);

  // Telemetry & Health State
  const [pingData, setPingData] = useState<{ latency_ms: number; edge_colo: string; status: string } | null>(null);

  // Module States
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [selectedLicenseIds, setSelectedLicenseIds] = useState<Set<string>>(new Set());
  const [expandedLicenseId, setExpandedLicenseId] = useState<string | null>(null);
  const [editingLicense, setEditingLicense] = useState<LicenseRecord | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
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
  const [showQrModal, setShowQrModal] = useState<boolean>(false);

  // Leases State
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [leaseSearch, setLeaseSearch] = useState<string>("");

  // SQL Console & Dynamic Schema Explorer
  const [sqlQuery, setSqlQuery] = useState<string>(
    "SELECT id, license_key, admin_key, plan, max_seats, status, customer_email FROM licenses ORDER BY created_at DESC LIMIT 25;"
  );
  const [sqlResults, setSqlResults] = useState<any[] | null>(null);
  const [sqlMeta, setSqlMeta] = useState<any>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [sqlHistory, setSqlHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("wpipe_sql_history") || "[]");
    } catch {
      return [];
    }
  });

  const [schemaTables, setSchemaTables] = useState<TableSchemaInfo[]>([]);
  const [loadingSchema, setLoadingSchema] = useState<boolean>(false);
  const [expandedSchemaTable, setExpandedSchemaTable] = useState<string | null>(null);
  const [schemaSearch, setSchemaSearch] = useState<string>("");
  const [selectedPresetCategory, setSelectedPresetCategory] = useState<string>("metrics");

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>("");

  const planBreakdown = useMemo(() => {
    const counts: Record<string, number> = { starter: 0, pro: 0, enterprise: 0, vip: 0, other: 0 };
    licenses.forEach((l) => {
      const p = (l.plan || "").toLowerCase();
      if (p in counts) counts[p]++;
      else counts.other++;
    });
    const total = licenses.length || 1;
    return {
      starter: counts.starter,
      pro: counts.pro,
      enterprise: counts.enterprise,
      vip: counts.vip,
      starterPct: Math.round((counts.starter / total) * 100),
      proPct: Math.round((counts.pro / total) * 100),
      enterprisePct: Math.round((counts.enterprise / total) * 100),
      vipPct: Math.round((counts.vip / total) * 100),
    };
  }, [licenses]);

  const expiringSoonLicenses = useMemo(() => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 86400 * 1000;
    return licenses.filter((l) => {
      if (!l.expires_at) return false;
      const diff = new Date(l.expires_at).getTime() - now;
      return diff > 0 && diff <= thirtyDaysMs;
    });
  }, [licenses]);

  const extendExpiration = (days: number | null) => {
    if (!editingLicense) return;
    if (days === null) {
      setEditingLicense({ ...editingLicense, expires_at: null });
      return;
    }
    const base = editingLicense.expires_at ? new Date(editingLicense.expires_at) : new Date();
    const target = new Date(base.getTime() + days * 86400 * 1000);
    setEditingLicense({ ...editingLicense, expires_at: target.toISOString() });
  };

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

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
        throw new Error(json.message || "Invalid Super-Admin master secret.");
      }
      localStorage.setItem("wpipe_admin_master_token", keyToVerify);
      setIsAuthenticated(true);
      fetchInitialData(keyToVerify);
      loadSchemaExplorer(keyToVerify);
      showToast("Sesión de Super-Admin iniciada correctamente.");
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

  // NOC Auto-Refresh Interval Engine
  useEffect(() => {
    if (!isAuthenticated || autoRefreshInterval <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setRefreshCountdown(autoRefreshInterval);
    timerRef.current = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          fetchInitialData();
          return autoRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isAuthenticated, autoRefreshInterval]);

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
      showToast(`License ${editingLicense.license_key} updated successfully.`);
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
      showToast(`Estado cambiado a: ${nextStatus}`);
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

  // Bulk Operations
  const handleBulkStatus = async (targetStatus: "active" | "suspended") => {
    if (selectedLicenseIds.size === 0) return;
    const ids = Array.from(selectedLicenseIds);
    const placeholders = ids.map(() => "?").join(",");
    setLoading(true);
    try {
      await executeSql(
        `UPDATE licenses SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        [targetStatus, ...ids]
      );
      showToast(`${ids.length} licencias actualizadas a '${targetStatus}'.`);
      setSelectedLicenseIds(new Set());
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAddSeats = async (delta = 1) => {
    if (selectedLicenseIds.size === 0) return;
    const ids = Array.from(selectedLicenseIds);
    const placeholders = ids.map(() => "?").join(",");
    setLoading(true);
    try {
      await executeSql(
        `UPDATE licenses SET max_seats = max_seats + ?, max_machines = max_machines + ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        [delta, delta, ...ids]
      );
      showToast(`+${delta} asiento añadido a ${ids.length} licencias.`);
      setSelectedLicenseIds(new Set());
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectAllLicenses = () => {
    if (selectedLicenseIds.size === filteredLicenses.length) {
      setSelectedLicenseIds(new Set());
    } else {
      setSelectedLicenseIds(new Set(filteredLicenses.map((l) => l.id)));
    }
  };

  const toggleSelectLicense = (id: string) => {
    const next = new Set(selectedLicenseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLicenseIds(next);
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
      showToast(`VIP License minted successfully for ${json.customer_name || "Partner"}!`);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Kick Specific Lease
  const handleKickLease = async (leaseId: string) => {
    if (!confirm("Are you sure you want to kick this workstation? It will disconnect immediately.")) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/v1/admin/leases/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${masterKey}` },
        body: JSON.stringify({ lease_id: leaseId }),
      });
      showToast("Workstation kicked successfully.");
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
      showToast(`Purga completada: ${json.purged_count || 0} puestos expirados liberados.`);
      fetchInitialData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Run Custom SQL Query with History and Safety Safeguards
  const handleRunSql = async (overrideQuery?: string) => {
    const queryToRun = overrideQuery || sqlQuery;
    if (!queryToRun.trim()) return;

    // Safety guard against accidental destructive D1 execution
    const upper = queryToRun.trim().toUpperCase();
    const isDestructive =
      upper.startsWith("DROP ") ||
      upper.startsWith("TRUNCATE ") ||
      (upper.startsWith("DELETE ") && !upper.includes("WHERE"));

    if (isDestructive && !overrideQuery) {
      const confirmDestructive = window.confirm(
        `⚠️ DESTRUCTIVE QUERY SAFEGUARD:\n\nYou are about to execute a potentially destructive database statement on Cloudflare D1:\n\n"${queryToRun}"\n\nThis will permanently remove or modify data in production. Do you wish to continue?`
      );
      if (!confirmDestructive) return;
    }

    setLoading(true);
    setError(null);
    setSqlResults(null);
    setSqlMeta(null);

    try {
      const data = await executeSql(queryToRun);
      setSqlResults(data.results || []);
      setSqlMeta(data.meta || null);

      // Save to SQL History
      const nextHistory = [queryToRun, ...sqlHistory.filter((q) => q !== queryToRun)].slice(0, 8);
      setSqlHistory(nextHistory);
      localStorage.setItem("wpipe_sql_history", JSON.stringify(nextHistory));
      showToast("Query executed successfully.");
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
    showToast("Copied to clipboard.");
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
    showToast(`Descargado ${filename}`);
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
    showToast(`Descargado ${filename}`);
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

  // Sorted SQL Results
  const sortedSqlResults = useMemo(() => {
    if (!sqlResults || !sortColumn) return sqlResults;
    return [...sqlResults].sort((a, b) => {
      const valA = a[sortColumn];
      const valB = b[sortColumn];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }, [sqlResults, sortColumn, sortAsc]);

  const handleSortHeader = (col: string) => {
    if (sortColumn === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortColumn(col);
      setSortAsc(true);
    }
  };

  // Categorized Presets Library
  const sqlPresets = [
    {
      category: "metrics",
      title: "Distribución por Plan",
      desc: "License count and total seats contracted per subscription tier.",
      sql: "SELECT plan, count(*) as licencias, sum(max_seats) as puestos_totales FROM licenses GROUP BY plan ORDER BY puestos_totales DESC;",
    },
    {
      category: "metrics",
      title: "Global Seat Utilization",
      desc: "Active connected workstations right now vs total active quota.",
      sql: "SELECT (SELECT count(*) FROM leases WHERE lease_expires_at > datetime('now')) as puestos_activos, (SELECT sum(max_seats) FROM licenses WHERE status='active') as puestos_contratados;",
    },
    {
      category: "metrics",
      title: "Top 10 Organizations by Quota",
      desc: "Enterprises with the highest seat allocation.",
      sql: "SELECT customer_name, customer_email, plan, max_seats, status, created_at FROM licenses ORDER BY max_seats DESC LIMIT 10;",
    },
    {
      category: "audit",
      title: "Latest 50 Audit Events",
      desc: "Audit trail of recent edge telemetry and webhook calls.",
      sql: "SELECT id, event_type, license_key, ip_address, created_at FROM audit_logs ORDER BY id DESC LIMIT 50;",
    },
    {
      category: "audit",
      title: "Recent OTP Security Codes",
      desc: "Last 20 OTP verification codes with usage status and expiration.",
      sql: "SELECT id, email, attempts, used, expires_at, created_at FROM otp_codes ORDER BY created_at DESC LIMIT 20;",
    },
    {
      category: "audit",
      title: "Connected Operating Systems",
      desc: "Floating leases breakdown by platform (Linux, Windows, macOS).",
      sql: "SELECT coalesce(os_name, 'Desconocido') as sistema_operativo, count(*) as maquinas_activas FROM leases GROUP BY os_name ORDER BY maquinas_activas DESC;",
    },
    {
      category: "maintenance",
      title: "Expired Licenses",
      desc: "Licenses with expiration date older than current UTC timestamp.",
      sql: "SELECT id, license_key, customer_email, expires_at, status FROM licenses WHERE expires_at IS NOT NULL AND expires_at < datetime('now');",
    },
    {
      category: "maintenance",
      title: "Stale Leases Ready for Purging",
      desc: "Leases whose heartbeat has expired and can be released.",
      sql: "SELECT id, license_id, hostname, os_name, lease_expires_at FROM leases WHERE lease_expires_at <= datetime('now');",
    },
    {
      category: "maintenance",
      title: "Orphan Licenses (No active seats)",
      desc: "Active licenses with zero workstations currently connected.",
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
                <span>Super-Admin Master Secret</span>
                <Lock size={12} className="text-indigo-400" />
              </label>
              <input
                type="password"
                value={masterKey}
                onChange={(e) => setMasterKey(e.target.value)}
                placeholder="Enter your master authority key..."
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
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Shield size={14} />
                  <span>Access Master Cockpit</span>
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
            <p className="text-[10px] text-gray-400 flex items-center gap-1.5">
              <span>William Rodriguez &bull;</span>
              {pingData ? (
                <span className="text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {pingData.edge_colo} ({pingData.latency_ms}ms)
                </span>
              ) : (
                <span className="text-gray-500">Connecting...</span>
              )}
              {autoRefreshInterval > 0 && (
                <span className="text-indigo-400 font-mono text-[9px] bg-indigo-950/80 px-1.5 py-0.2 rounded border border-indigo-800">
                  NOC Auto-Poll: {refreshCountdown}s
                </span>
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
            <span>Licenses ({licenses.length})</span>
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
            <span>VIP Minter</span>
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
            <span>Floating Leases ({leases.length})</span>
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
            <span>D1 SQL Console</span>
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
            <span>Audit Trail</span>
          </button>
        </div>

        {/* NOC Refresh Selector & Logout */}
        <div className="flex items-center gap-2">
          {/* Suite Fast Links */}
          <div className="hidden 2xl:flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5 text-[11px] font-medium mr-1">
            <a
              href="https://wpipe-studio.wisrovi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 text-gray-400 hover:text-white rounded hover:bg-gray-800 transition"
            >
              Docs
            </a>
            <a
              href="https://studio.wisrovi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 text-cyan-400 hover:text-cyan-300 rounded hover:bg-gray-800 transition flex items-center gap-1"
            >
              <span>⚡</span> Studio
            </a>
            <a
              href="https://portal.wisrovi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 text-emerald-400 hover:text-emerald-300 rounded hover:bg-gray-800 transition flex items-center gap-1"
            >
              <span>🔑</span> Portal
            </a>
          </div>

          {/* NOC Polling Switcher */}
          <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs">
            <Radio size={12} className={autoRefreshInterval > 0 ? "text-emerald-400 animate-pulse" : "text-gray-500"} />
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(parseInt(e.target.value, 10))}
              className="bg-transparent text-gray-300 text-[11px] focus:outline-none cursor-pointer"
              title="Auto-refresco estilo NOC"
            >
              <option value="0" className="bg-gray-900">Auto: OFF</option>
              <option value="10" className="bg-gray-900">Auto: 10s</option>
              <option value="30" className="bg-gray-900">Auto: 30s</option>
              <option value="60" className="bg-gray-900">Auto: 60s</option>
            </select>
          </div>

          <button
            onClick={() => fetchInitialData()}
            disabled={loading}
            className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer border border-gray-700/60"
            title="Recargar datos manualmente"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>

          <button
            onClick={handleLogout}
            className="py-1.5 px-3 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 rounded-lg transition text-xs flex items-center gap-1.5 cursor-pointer font-medium"
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Floating Modern Toast Stack */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div
            className={`p-3.5 rounded-xl border shadow-2xl flex items-center gap-3 backdrop-blur-xl ${
              toastMessage.type === "success"
                ? "bg-emerald-950/90 border-emerald-600 text-emerald-200"
                : toastMessage.type === "error"
                ? "bg-red-950/90 border-red-600 text-red-200"
                : "bg-indigo-950/90 border-indigo-600 text-indigo-200"
            }`}
          >
            {toastMessage.type === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
            )}
            <span className="text-xs font-medium">{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Main Content Body - Fullscreen Ultra-Wide Responsive */}
      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
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
                  <span className="text-[11px] text-gray-400 block font-medium">Total Licenses</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.total_licenses ?? licenses.length}
                  </div>
                  <span className="text-[10px] text-indigo-400 font-mono">
                    {stats?.active_licenses ?? 0} active in production
                  </span>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-xl">
                  <Laptop size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Live Floating Leases</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.active_floating_leases ?? leases.length}
                  </div>
                  <span className="text-[10px] text-purple-400 font-mono">Workstations connected today</span>
                </div>
              </div>

              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 text-xl">
                  <Terminal size={24} />
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Audit Events (Last 7 Days)</span>
                  <div className="text-2xl font-black text-white">
                    {stats?.recent_audit_events_7d ?? 0}
                  </div>
                  <span className="text-[10px] text-pink-400 font-mono">Security events & webhooks</span>
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
                    Cloudflare D1 &bull; 0 €/mo
                  </span>
                </div>
              </div>
            </div>

            {/* Plan Distribution & Expiring Alerts Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Segmented Plan Distribution */}
              <div className="lg:col-span-2 bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-indigo-400" />
                    <span>License Distribution by Subscription Tier</span>
                  </span>
                  <span className="text-[11px] text-gray-400 font-mono">
                    Total: {licenses.length} active licenses
                  </span>
                </div>

                {/* Segmented Bar */}
                <div className="w-full h-3 bg-gray-900 rounded-full overflow-hidden flex">
                  {planBreakdown.starter > 0 && (
                    <div
                      style={{ width: `${planBreakdown.starterPct}%` }}
                      className="bg-blue-500 h-full transition-all"
                      title={`Starter: ${planBreakdown.starter} (${planBreakdown.starterPct}%)`}
                    />
                  )}
                  {planBreakdown.pro > 0 && (
                    <div
                      style={{ width: `${planBreakdown.proPct}%` }}
                      className="bg-indigo-500 h-full transition-all"
                      title={`Pro: ${planBreakdown.pro} (${planBreakdown.proPct}%)`}
                    />
                  )}
                  {planBreakdown.enterprise > 0 && (
                    <div
                      style={{ width: `${planBreakdown.enterprisePct}%` }}
                      className="bg-purple-500 h-full transition-all"
                      title={`Enterprise: ${planBreakdown.enterprise} (${planBreakdown.enterprisePct}%)`}
                    />
                  )}
                  {planBreakdown.vip > 0 && (
                    <div
                      style={{ width: `${planBreakdown.vipPct}%` }}
                      className="bg-amber-400 h-full transition-all"
                      title={`VIP: ${planBreakdown.vip} (${planBreakdown.vipPct}%)`}
                    />
                  )}
                </div>

                {/* Legend badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="flex items-center gap-1.5 bg-gray-900/80 px-2 py-1 rounded border border-gray-800">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-gray-300">Starter:</span>
                    <strong className="text-white ml-auto">{planBreakdown.starter}</strong>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-900/80 px-2 py-1 rounded border border-gray-800">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span className="text-gray-300">Pro:</span>
                    <strong className="text-white ml-auto">{planBreakdown.pro}</strong>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-900/80 px-2 py-1 rounded border border-gray-800">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    <span className="text-gray-300">Enterprise:</span>
                    <strong className="text-white ml-auto">{planBreakdown.enterprise}</strong>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-900/80 px-2 py-1 rounded border border-gray-800">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-gray-300">VIP/Partner:</span>
                    <strong className="text-white ml-auto">{planBreakdown.vip}</strong>
                  </div>
                </div>
              </div>

              {/* Expiring Soon Watchdog */}
              <div className="bg-[#0f172a] border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <AlertTriangle size={14} className={expiringSoonLicenses.length > 0 ? "text-amber-400" : "text-gray-500"} />
                    <span>Upcoming Expirations (&lt;30d)</span>
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    expiringSoonLicenses.length > 0
                      ? "bg-amber-950 text-amber-300 border border-amber-800"
                      : "bg-gray-800 text-gray-400"
                  }`}>
                    {expiringSoonLicenses.length} alerts
                  </span>
                </div>

                {expiringSoonLicenses.length > 0 ? (
                  <div className="space-y-2 mt-2 max-h-24 overflow-y-auto pr-1">
                    {expiringSoonLicenses.map((lic) => (
                      <div key={lic.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-gray-900/80 border border-gray-800 font-mono">
                        <div className="truncate max-w-[130px]">
                          <span className="text-white font-bold block truncate">{lic.customer_name || lic.customer_email}</span>
                          <span className="text-[10px] text-amber-400">{lic.expires_at?.slice(0, 10)}</span>
                        </div>
                        <button
                          onClick={() => setEditingLicense(lic)}
                          className="px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 rounded text-[10px] cursor-pointer"
                        >
                          Renew
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-gray-500 font-sans">
                    ✓ No licenses at risk of expiring this month.
                  </div>
                )}
                <span className="text-[10px] text-gray-500 font-mono block mt-2">
                  Automatic watchdog via Cloudflare D1
                </span>
              </div>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* VIP Minter Quick Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles size={18} />
                  <h3 className="font-bold text-sm text-white">VIP & Partner Minter</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Mint institutional licenses for partners, universities or demos with instant VS Code activation.
                </p>
                <button
                  onClick={() => setActiveTab("vip_minter")}
                  className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} />
                  <span>Open License Minter</span>
                </button>
              </div>

              {/* D1 SQL Console Quick Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-purple-400">
                  <Database size={18} />
                  <h3 className="font-bold text-sm text-white">SQL & Schema Explorer</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Dynamically inspect D1 tables, execute analytical queries, and export results to CSV or JSON.
                </p>
                <button
                  onClick={() => setActiveTab("sql_console")}
                  className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Database size={14} />
                  <span>Launch SQL Console</span>
                </button>
              </div>

              {/* Maintenance & Telemetry Card */}
              <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-2 text-pink-400">
                  <Zap size={18} />
                  <h3 className="font-bold text-sm text-white">Lease Governance</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  1-click purge of orphan leases without heartbeat to liberate customer seat capacity.
                </p>
                <button
                  onClick={handlePurgeExpiredLeases}
                  disabled={loading}
                  className="w-full py-2 px-4 bg-gray-800 hover:bg-gray-700 text-pink-300 border border-pink-900/60 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} />
                  <span>Purge Expired Leases</span>
                </button>
              </div>
            </div>

            {/* Recent Connected Stations Snapshot */}
            <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Laptop size={18} className="text-indigo-400" />
                  <h3 className="font-bold text-sm text-white">Recently Connected Floating Leases</h3>
                </div>
                <button
                  onClick={() => setActiveTab("leases")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <span>View all ({leases.length})</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="pb-2 font-medium">Workstation / Hostname</th>
                      <th className="pb-2 font-medium">OS</th>
                      <th className="pb-2 font-medium">Client / License</th>
                      <th className="pb-2 font-medium">Last Heartbeat</th>
                      <th className="pb-2 font-medium text-right">Action</th>
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
                            Kick
                          </button>
                        </td>
                      </tr>
                    ))}
                    {leases.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-gray-500 font-sans">
                          No active floating leases connected right now.
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
        {/* TAB 2: ADVANCED LICENSE MANAGER (BATCH OPERATIONS & ACCORDION) */}
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
                    placeholder="Search by email, name or license key..."
                    className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="expired">Expired</option>
                </select>

                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none"
                >
                  <option value="all">All tiers</option>
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
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={() => setActiveTab("vip_minter")}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles size={13} />
                  <span>+ Mint VIP License</span>
                </button>
              </div>
            </div>

            {/* Batch Action Floating Toolbar (Appears when 1+ selected) */}
            {selectedLicenseIds.size > 0 && (
              <div className="bg-indigo-950/80 border border-indigo-700 p-3 rounded-xl flex items-center justify-between shadow-xl animate-in fade-in duration-200">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white">
                    {selectedLicenseIds.size} seleccionada{selectedLicenseIds.size > 1 ? "s" : ""}:
                  </span>
                  <button
                    onClick={() => handleBulkStatus("active")}
                    className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium cursor-pointer"
                  >
                    Activate All
                  </button>
                  <button
                    onClick={() => handleBulkStatus("suspended")}
                    className="px-2.5 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs font-medium cursor-pointer"
                  >
                    Suspend All
                  </button>
                  <button
                    onClick={() => handleBulkAddSeats(1)}
                    className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-xs font-medium cursor-pointer"
                  >
                    +1 Seat to All
                  </button>
                </div>

                <button
                  onClick={() => setSelectedLicenseIds(new Set())}
                  className="text-xs text-gray-400 hover:text-white cursor-pointer"
                >
                  Deselect
                </button>
              </div>
            )}

            {/* Licenses Table with Accordion Leases */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 font-medium">
                    <th className="pb-3 w-8">
                      <button
                        onClick={toggleSelectAllLicenses}
                        className="text-gray-400 hover:text-white cursor-pointer"
                        title="Select all"
                      >
                        {selectedLicenseIds.size === filteredLicenses.length && filteredLicenses.length > 0 ? (
                          <CheckSquare size={14} className="text-indigo-400" />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                    </th>
                    <th className="pb-3 w-8"></th>
                    <th className="pb-3">Workstation Key (VS Code)</th>
                    <th className="pb-3">Private Admin Key</th>
                    <th className="pb-3">Customer / Email</th>
                    <th className="pb-3">Plan</th>
                    <th className="pb-3 text-center">Seats</th>
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {filteredLicenses.map((lic) => {
                    const isExpanded = expandedLicenseId === lic.id;
                    const isSelected = selectedLicenseIds.has(lic.id);
                    const connectedLeases = leases.filter((l) => l.license_id === lic.id);

                    return (
                      <React.Fragment key={lic.id}>
                        <tr className={`hover:bg-gray-800/30 transition ${isSelected ? "bg-indigo-950/20" : ""}`}>
                          <td className="py-3 text-center">
                            <button
                              onClick={() => toggleSelectLicense(lic.id)}
                              className="text-gray-500 hover:text-white cursor-pointer"
                            >
                              {isSelected ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                            </button>
                          </td>

                          <td className="py-3 text-center">
                            <button
                              onClick={() => setExpandedLicenseId(isExpanded ? null : lic.id)}
                              className="text-gray-500 hover:text-indigo-400 cursor-pointer"
                              title="View connected workstations"
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
                                title="Copy workstation key"
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
                                  title="Copy admin key"
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
                              {lic.status === "active" ? "Active" : "Suspended"}
                            </button>
                          </td>

                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingLicense(lic)}
                                className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded cursor-pointer"
                                title="Edit license"
                              >
                                <Edit3 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Accordion Drawer: Connected Leases */}
                        {isExpanded && (
                          <tr className="bg-gray-950/60">
                            <td colSpan={9} className="p-4 pl-12 border-b border-gray-800/80">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-gray-400 font-sans">
                                  <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                                    <Laptop size={13} />
                                    <span>Workstations currently holding this license ({connectedLeases.length}/{lic.max_seats}):</span>
                                  </span>
                                </div>

                                {connectedLeases.length === 0 ? (
                                  <p className="text-gray-500 text-xs italic font-sans">
                                    No workstation connected at this moment.
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
                                          Kick
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
                      <span>Edit License: {editingLicense.license_key}</span>
                    </h3>
                    <button
                      onClick={() => setEditingLicense(null)}
                      className="text-gray-400 hover:text-white font-bold text-base cursor-pointer"
                    >
                      &times;
                    </button>
                  </div>

                  <form onSubmit={handleSaveLicenseEdit} className="space-y-3 text-xs">
                    <div>
                      <label className="text-gray-400 block mb-1">Customer</label>
                      <input
                        type="text"
                        disabled
                        value={`${editingLicense.customer_name} (${editingLicense.customer_email})`}
                        className="w-full px-3 py-2 bg-gray-900/60 border border-gray-800 rounded text-gray-400 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-gray-300 block mb-1">Status</label>
                        <select
                          value={editingLicense.status}
                          onChange={(e) => setEditingLicense({ ...editingLicense, status: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                        >
                          <option value="active">active (Active)</option>
                          <option value="suspended">suspended (Suspended)</option>
                          <option value="expired">expired (Expired)</option>
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
                      <label className="text-gray-300 block mb-1">Maximum Seats (Floating Leases)</label>
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
                      <label className="text-gray-300 block mb-1">Expiration Date (ISO / Empty = Lifetime)</label>
                      <input
                        type="text"
                        value={editingLicense.expires_at || ""}
                        onChange={(e) => setEditingLicense({ ...editingLicense, expires_at: e.target.value || null })}
                        placeholder="Ej. 2027-12-31T23:59:59Z o dejar vacío"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white font-mono"
                      />
                      <div className="flex items-center gap-1.5 pt-1.5">
                        <button
                          type="button"
                          onClick={() => extendExpiration(30)}
                          className="px-2 py-0.5 bg-gray-800 hover:bg-indigo-900 border border-gray-700 hover:border-indigo-600 rounded text-[10px] text-gray-300 hover:text-white cursor-pointer transition"
                        >
                          +30 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => extendExpiration(90)}
                          className="px-2 py-0.5 bg-gray-800 hover:bg-indigo-900 border border-gray-700 hover:border-indigo-600 rounded text-[10px] text-gray-300 hover:text-white cursor-pointer transition"
                        >
                          +90 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => extendExpiration(365)}
                          className="px-2 py-0.5 bg-gray-800 hover:bg-indigo-900 border border-gray-700 hover:border-indigo-600 rounded text-[10px] text-gray-300 hover:text-white cursor-pointer transition"
                        >
                          +1 Year
                        </button>
                        <button
                          type="button"
                          onClick={() => extendExpiration(null)}
                          className="px-2 py-0.5 bg-purple-950/80 hover:bg-purple-900 border border-purple-800 rounded text-[10px] text-purple-200 cursor-pointer transition"
                        >
                          Perpetual (Lifetime)
                        </button>
                      </div>
                    </div>

                    <div className="pt-3 flex items-center justify-end gap-2 border-t border-gray-800">
                      <button
                        type="button"
                        onClick={() => setEditingLicense(null)}
                        className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-medium cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold transition cursor-pointer"
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: PRO VIP & PARTNER MINTER WITH DEEP LINK & QR CODE */}
        {/* =================================================================== */}
        {activeTab === "vip_minter" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: What is VIP Minter explanation card */}
            <div className="bg-[#0f172a] border border-indigo-900/60 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 text-indigo-400">
                <HelpCircle size={20} />
                <h3 className="font-extrabold text-base text-white">VIP & Partner Authority</h3>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                El flujo estándar de WPipe Studio cobra a través de **Lemon Squeezy** con tarjeta de crédito y crea la licencia vía webhooks automáticos.
              </p>
              <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-xl space-y-2 text-xs text-indigo-200">
                <span className="font-bold block text-white">🎯 Casos de Uso Soberano:</span>
                <ul className="list-disc list-inside space-y-1 text-gray-300 text-[11px]">
                  <li><strong>Partners Comerciales:</strong> Convenios B2B donde la facturación va por factura bancaria.</li>
                  <li><strong>Universidades & Aceleradoras:</strong> Donación de cupos de 50 asientos para formación.</li>
                  <li><strong>Influencers & Ambassadors:</strong> Complimentary licenses for technical outreach.</li>
                  <li><strong>Internal Teams:</strong> Master licenses with unlimited seats for development.</li>
                </ul>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Issues Ed25519 cryptographic signatures in D1 identical to commercial sales, generating a <strong>Private Administration Key</strong> for governance.
              </p>
            </div>

            {/* Middle: Minting Form */}
            <div className="lg:col-span-2 bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles size={16} className="text-purple-400" />
                    <span>VIP & Partner License Minter</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Instant cryptographic issuance on Cloudflare D1 with 1-click deep links.
                  </p>
                </div>
              </div>

              <form onSubmit={handleMintVip} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 font-medium mb-1">Partner / Organization Name</label>
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
                    <label className="block text-gray-300 font-medium mb-1">Contact Email</label>
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
                    <label className="block text-gray-300 font-medium mb-1">Subscription Tier</label>
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
                    <label className="block text-gray-300 font-medium mb-1">Concurrent Seats Quota</label>
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
                    <label className="block text-gray-300 font-medium mb-1">Validity / Duration</label>
                    <select
                      value={vipDuration}
                      onChange={(e) => setVipDuration(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                    >
                      <option value="30">30 Days (Demo)</option>
                      <option value="90">90 Days (Quarterly)</option>
                      <option value="365">1 Year (Annual Partner)</option>
                      <option value="permanent">Perpetual (Lifetime)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-300 font-medium mb-1 flex items-center justify-between">
                    <span>Custom Key (Optional)</span>
                    <span className="text-[10px] text-gray-500 font-mono">Leave empty to autogenerate</span>
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
                  <span>{loading ? "Minting in Cloudflare D1..." : "Mint & Register Official License"}</span>
                </button>
              </form>

              {/* Minter Output with VS Code Deep Link & QR Preview */}
              {vipResult && (
                <div className="mt-4 p-4 bg-purple-950/40 border border-purple-800 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-purple-300 font-bold">
                      <CheckCircle2 size={16} />
                      <span>License Minted & Active in Cloudflare D1!</span>
                    </div>

                    <button
                      onClick={() => setShowQrModal(true)}
                      className="px-2.5 py-1 bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-700 rounded text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <QrCode size={13} />
                      <span>View QR Code</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                    <div className="bg-gray-900/90 p-3 rounded-lg border border-gray-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-gray-400 block">Workstation Key (VS Code):</span>
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
                        <span className="text-[10px] text-gray-400 block">Private Admin Key:</span>
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

                  {/* 1-Click VS Code Deep Link */}
                  <div className="bg-indigo-950/60 border border-indigo-800 p-3 rounded-lg flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white block">1-Click Activation Link for VS Code:</span>
                      <code className="text-[11px] text-indigo-300 font-mono">
                        vscode://wisrovi.wpipe-studio-vscode/activate?key={vipResult.license_key}
                      </code>
                    </div>
                    <button
                      onClick={() =>
                        handleCopy(`vscode://wisrovi.wpipe-studio-vscode/activate?key=${vipResult.license_key}`)
                      }
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Copy Deep Link
                    </button>
                  </div>

                  {/* Ready to send email template */}
                  <div className="p-3 bg-gray-900/90 rounded-lg border border-gray-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-300 font-sans font-bold flex items-center gap-1.5">
                        <Send size={12} className="text-purple-400" />
                        <span>Email Template for Partner (Ready to send):</span>
                      </span>
                      <button
                        onClick={() => {
                          const emailText = `Hello ${vipName || "Partner"},\n\nHere is your official WPipe Studio license (${vipResult.plan.toUpperCase()} - ${vipResult.max_seats} seats):\n\n- Workstation Key (VS Code): ${vipResult.license_key}\n- Private Admin Key: ${vipResult.admin_key}\n- Self-Service Portal: https://portal.wisrovi.dev\n\n1-Click activation for VS Code:\nvscode://wisrovi.wpipe-studio-vscode/activate?key=${vipResult.license_key}\n\nActivate via terminal:\nwpipe license activate --key ${vipResult.license_key}\n\nBest regards,\nWilliam Rodriguez - wisrovi.dev`;
                          handleCopy(emailText);
                        }}
                        className="text-[10px] text-purple-300 hover:text-white cursor-pointer"
                      >
                        {copiedKey?.includes("Hello") ? "Email Template Copied!" : "Copy Full Email Template"}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap bg-gray-950 p-2.5 rounded border border-gray-800/60 leading-relaxed">
{`Hello ${vipName || "Partner"},

Here is your official WPipe Studio license (${vipResult.plan.toUpperCase()} - ${vipResult.max_seats} seats):

- Workstation Key (VS Code): ${vipResult.license_key}
- Private Admin Key: ${vipResult.admin_key}
- Self-Service Portal: https://portal.wisrovi.dev

1-Click activation for VS Code:
vscode://wisrovi.wpipe-studio-vscode/activate?key=${vipResult.license_key}

Activate via terminal:
wpipe license activate --key ${vipResult.license_key}

Best regards,
William Rodriguez - wisrovi.dev`}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* QR Code Modal Preview */}
            {showQrModal && vipResult && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#0f172a] border border-purple-700 rounded-2xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
                  <h3 className="font-bold text-white text-base">Activation QR Code</h3>
                  <p className="text-xs text-gray-400">
                    Scan to activate license in VS Code or mobile test device.
                  </p>
                  <div className="bg-white p-4 rounded-xl inline-block shadow-inner">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                        `vscode://wisrovi.wpipe-studio-vscode/activate?key=${vipResult.license_key}`
                      )}`}
                      alt="Activation QR"
                      className="w-44 h-44 mx-auto"
                    />
                  </div>
                  <div className="font-mono text-xs text-indigo-300 font-bold">{vipResult.license_key}</div>
                  <button
                    onClick={() => setShowQrModal(false)}
                    className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
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
                  <span>Live Floating Leases Monitor</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Workstations running pipelines worldwide. Heartbeat every 30 min.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-2.5 text-gray-500" />
                  <input
                    type="text"
                    value={leaseSearch}
                    onChange={(e) => setLeaseSearch(e.target.value)}
                    placeholder="Filter by hostname, OS or hash..."
                    className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white"
                  />
                </div>

                <button
                  onClick={handlePurgeExpiredLeases}
                  className="px-3 py-1.5 bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  <span>Purge Expired</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 font-medium">
                    <th className="pb-3">Associated License</th>
                    <th className="pb-3">Hostname</th>
                    <th className="pb-3">SO</th>
                    <th className="pb-3">Machine Fingerprint (SHA-256)</th>
                    <th className="pb-3">Last Heartbeat</th>
                    <th className="pb-3">Expires</th>
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
                      <td className="py-3 text-gray-400 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[130px] font-mono">{le.machine_fingerprint}</span>
                          <button
                            type="button"
                            onClick={() => setLeaseSearch(le.machine_fingerprint)}
                            className="text-gray-500 hover:text-indigo-400 cursor-pointer p-0.5"
                            title="Filter all connections from this machine"
                          >
                            <Search size={11} />
                          </button>
                        </div>
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
                          Kick
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredLeases.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-500 font-sans">
                        No floating leases found matching the search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 5: D1 SQL CONSOLE WITH DYNAMIC SCHEMA, HISTORY & SORTABLE TABLE */}
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
                    <span>D1 Tables ({schemaTables.length})</span>
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

                {/* Schema Search Filter */}
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-2 text-gray-500" />
                  <input
                    type="text"
                    value={schemaSearch}
                    onChange={(e) => setSchemaSearch(e.target.value)}
                    placeholder="Filter tables or fields..."
                    className="w-full pl-7 pr-2 py-1 bg-gray-900 border border-gray-800 rounded text-[11px] text-white placeholder-gray-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {schemaTables
                    .filter((tbl) => {
                      if (!schemaSearch.trim()) return true;
                      const term = schemaSearch.toLowerCase();
                      const matchTable = tbl.name.toLowerCase().includes(term);
                      const matchCol = tbl.columns.some((c) => c.name.toLowerCase().includes(term));
                      return matchTable || matchCol;
                    })
                    .map((tbl) => {
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
                    <span>Predefined Queries</span>
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
                    Metrics
                  </button>
                  <button
                    onClick={() => setSelectedPresetCategory("audit")}
                    className={`py-1 rounded text-center cursor-pointer ${
                      selectedPresetCategory === "audit"
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Audit
                  </button>
                  <button
                    onClick={() => setSelectedPresetCategory("maintenance")}
                    className={`py-1 rounded text-center cursor-pointer ${
                      selectedPresetCategory === "maintenance"
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Maintenance
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
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

              {/* SQL Query History Pills */}
              {sqlHistory.length > 0 && (
                <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-2">
                  <div className="flex items-center justify-between pb-1 border-b border-gray-800">
                    <span className="font-bold text-[11px] text-gray-400 flex items-center gap-1">
                      <History size={12} className="text-gray-400" />
                      <span>Recent History</span>
                    </span>
                    <button
                      onClick={() => {
                        setSqlHistory([]);
                        localStorage.removeItem("wpipe_sql_history");
                      }}
                      className="text-[10px] text-gray-500 hover:text-red-400 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {sqlHistory.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => setSqlQuery(h)}
                        className="w-full text-left p-1.5 rounded bg-gray-900/80 hover:bg-gray-800 text-[10px] font-mono text-gray-400 hover:text-indigo-300 truncate block cursor-pointer transition"
                        title={h}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: SQL Editor & Sortable Results */}
            <div className="lg:col-span-3 bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Database size={18} className="text-indigo-400" />
                    <span>Direct SQL Console on Cloudflare D1</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Instant execution against Cloudflare distributed SQLite cluster.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRunSql()}
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-indigo-500/20 cursor-pointer flex items-center gap-1.5"
                  >
                    <Play size={13} />
                    <span>Execute SQL</span>
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
                      Filas: <strong className="text-white">{sortedSqlResults?.length ?? 0}</strong>
                    </span>
                    <span>
                      Región: <strong className="text-purple-400">{sqlMeta.served_by_region || "GLOBAL"}</strong>
                    </span>
                  </div>

                  {sortedSqlResults && sortedSqlResults.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => exportToCsv(sortedSqlResults, "d1_query_results.csv")}
                        className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 cursor-pointer font-sans"
                      >
                        <Download size={10} />
                        <span>CSV</span>
                      </button>
                      <button
                        onClick={() => exportToJson(sortedSqlResults, "d1_query_results.json")}
                        className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded flex items-center gap-1 cursor-pointer font-sans"
                      >
                        <Download size={10} />
                        <span>JSON</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Sortable Results Tabular View */}
              {sortedSqlResults && (
                <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-800 rounded-xl">
                  {sortedSqlResults.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-xs font-sans">
                      La consulta se ejecutó con éxito pero no devolvió filas.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 text-gray-300">
                        <tr>
                          {Object.keys(sortedSqlResults[0]).map((col) => (
                            <th
                              key={col}
                              onClick={() => handleSortHeader(col)}
                              className="p-2.5 font-semibold cursor-pointer hover:bg-gray-800/80 transition select-none"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>{col}</span>
                                <ArrowUpDown size={11} className={sortColumn === col ? "text-indigo-400" : "text-gray-600"} />
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {sortedSqlResults.map((row, idx) => (
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
                  <span>Flujo de Audit & Webhooks de Lemon Squeezy</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Log of cryptographic events, activations, liberations, and purchases.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-2.5 text-gray-500" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Filter by event, IP or key..."
                    className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white"
                  />
                </div>

                <button
                  onClick={() => exportToCsv(filteredAuditLogs, "wpipe_audit_logs.csv")}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Download size={13} />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto border border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="p-3">ID</th>
                    <th className="p-3">Event</th>
                    <th className="p-3">License Key</th>
                    <th className="p-3">Source IP</th>
                    <th className="p-3">JSON Details</th>
                    <th className="p-3">Date & Time</th>
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
                        No audit records found.
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
