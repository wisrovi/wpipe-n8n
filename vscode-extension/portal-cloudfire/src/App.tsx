/**
 * WPipe Studio - Enterprise Customer Self-Service Portal
 * Deployed at: portal.wisrovi.dev (Cloudflare Pages at 0 €/month)
 * Multi-License Organization Management & Secure OTP Authentication
 * Author: William Rodriguez (wisrovi.dev)
 */

import React, { useState, useEffect } from "react";
import {
  Laptop,
  CheckCircle2,
  Clock,
  LogOut,
  RefreshCw,
  ExternalLink,
  PlusCircle,
  HelpCircle,
  AlertTriangle,
  Building2,
  Copy,
  Layers,
  Mail,
  Key,
  ShieldCheck,
  ArrowLeft,
  Send,
  Lock,
} from "lucide-react";

interface Device {
  id: string;
  machine_fingerprint: string;
  hostname: string | null;
  os_name: string | null;
  last_heartbeat_at: string;
  lease_expires_at: string;
  created_at: string;
}

interface OrganizationLicense {
  id: string;
  license_key: string;
  admin_key?: string;
  plan: string;
  status: string;
  max_seats: number;
  active_seats: number;
  customer_name: string;
  customer_email: string;
  expires_at: string | null;
}

interface LicenseOverview {
  license_key: string;
  admin_key?: string;
  customer_name: string;
  customer_email: string;
  plan: string;
  max_seats: number;
  active_seats: number;
  available_seats: number;
  expires_at: string | null;
  devices: Device[];
  organization_licenses?: OrganizationLicense[];
}

const API_BASE = "https://api.wisrovi.dev";

export default function App() {
  // Auth state
  const [authMode, setAuthMode] = useState<"otp" | "admin_key">("otp");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");
  const [emailInput, setEmailInput] = useState<string>("");
  const [codeInput, setCodeInput] = useState<string>("");
  const [adminKeyInput, setAdminKeyInput] = useState<string>("");

  const [token, setToken] = useState<string | null>(() => localStorage.getItem("wpipe_portal_session_token"));
  const [currentKey, setCurrentKey] = useState<string | null>(() => localStorage.getItem("wpipe_active_key"));
  const [data, setData] = useState<LicenseOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAdminKeys, setShowAdminKeys] = useState<boolean>(false);

  // Load overview for authorized session
  const fetchOverview = async (authToken: string, targetKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = targetKey
        ? `${API_BASE}/v1/portal/overview?key=${encodeURIComponent(targetKey)}`
        : `${API_BASE}/v1/portal/overview`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "No se pudo cargar la información de la licencia.");
      }
      const json: LicenseOverview = await res.json();
      setData(json);
      setCurrentKey(json.license_key);
      localStorage.setItem("wpipe_active_key", json.license_key);
    } catch (err: any) {
      setError(err.message || "Error al conectar con el servidor.");
      if (err.message && (err.message.includes("UNAUTHORIZED") || err.message.includes("expirada"))) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchOverview(token, currentKey || undefined);
    }
  }, [token]);

  // Request 6-digit OTP code to corporate email
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/v1/portal/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || "Error al enviar código de verificación.");
      }

      setOtpStep("code");
      setActionNotice(`Código de seguridad de 6 dígitos enviado a ${cleanEmail}`);
    } catch (err: any) {
      setError(err.message || "Error al solicitar código OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Verify 6-digit OTP code
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanCode = codeInput.trim();
    if (!cleanEmail || !cleanCode) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/v1/portal/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, code: cleanCode }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || "Código incorrecto o expirado.");
      }

      localStorage.setItem("wpipe_portal_session_token", json.token);
      setToken(json.token);
      fetchOverview(json.token);
    } catch (err: any) {
      setError(err.message || "Error al verificar código.");
    } finally {
      setLoading(false);
    }
  };

  // Login with private Admin Key
  const handleLoginAdminKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = adminKeyInput.trim().toUpperCase();
    if (!cleanKey) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/v1/portal/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_key: cleanKey }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || "Clave no válida.");
      }

      localStorage.setItem("wpipe_portal_session_token", json.token);
      setToken(json.token);
      fetchOverview(json.token);
    } catch (err: any) {
      setError(err.message || "Error al autenticar con clave.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("wpipe_portal_session_token");
    localStorage.removeItem("wpipe_active_key");
    setToken(null);
    setCurrentKey(null);
    setData(null);
    setEmailInput("");
    setCodeInput("");
    setAdminKeyInput("");
    setOtpStep("email");
    setError(null);
    setActionNotice(null);
  };

  const handleSwitchLicense = (newKey: string) => {
    if (!token || newKey === currentKey) return;
    fetchOverview(token, newKey);
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleLiberateSeat = async (leaseId: string, hostname: string | null) => {
    if (!token) return;
    const confirmKick = window.confirm(
      `¿Deseas liberar inmediatamente el asiento del equipo "${hostname || "PC"}"? El nuevo ordenador podrá usar la licencia Pro en 1 segundo.`
    );
    if (!confirmKick) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/portal/seats/${leaseId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error("No se pudo liberar el asiento.");
      }
      setActionNotice(`✅ Asiento del equipo "${hostname || "PC"}" liberado exitosamente.`);
      await fetchOverview(token, currentKey || undefined);
    } catch (err: any) {
      setError(err.message || "Error al liberar el asiento.");
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // VIEW 1: Secure Authentication Gate (OTP & Admin Key)
  // ---------------------------------------------------------------------------
  if (!token || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#0f172a] to-[#07090e]">
        <div className="w-full max-w-md bg-[#131b2e] border border-sky-800/60 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white text-2xl shadow-xl shadow-sky-500/25 mb-3">
              W
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              WPipe Studio
            </h1>
            <p className="text-xs text-sky-400 font-semibold tracking-wider uppercase mt-1 flex items-center justify-center gap-1.5">
              <ShieldCheck size={14} />
              <span>Portal de Autoservicio Enterprise</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Gestión segura de licencias corporativas, auditoría de equipos en tiempo real y liberación de asientos.
            </p>
          </div>

          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-900/90 rounded-xl mb-5 border border-gray-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode("otp");
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                authMode === "otp"
                  ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <Mail size={13} />
              <span>Correo (OTP)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("admin_key");
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                authMode === "admin_key"
                  ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <Key size={13} />
              <span>Clave Admin</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/80 border border-red-700/80 rounded-lg text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {actionNotice && (
            <div className="mb-4 p-3 bg-sky-950/80 border border-sky-700/80 rounded-lg text-xs text-sky-200 flex items-start gap-2">
              <CheckCircle2 size={15} className="text-sky-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{actionNotice}</span>
            </div>
          )}

          {/* TAB 1: Passwordless Email OTP */}
          {authMode === "otp" && (
            <div>
              {otpStep === "email" ? (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center justify-between">
                      <span>Correo Corporativo del Comprador</span>
                      <span className="text-[10px] text-gray-500 font-normal">Sin contraseñas</span>
                    </label>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="it-admin@empresa.com"
                      className="w-full px-3.5 py-2.5 bg-gray-900/90 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-sans"
                      required
                      autoFocus
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                      Te enviaremos un código de seguridad de 6 dígitos de un solo uso para verificar que eres el propietario del buzón.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Send size={14} />
                    <span>{loading ? "Enviando código..." : "Enviar Código de Seguridad"}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Verificando:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpStep("email");
                        setCodeInput("");
                        setError(null);
                      }}
                      className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft size={12} />
                      <span>Cambiar correo</span>
                    </button>
                  </div>

                  <div className="p-2.5 bg-gray-900/80 rounded-lg border border-gray-800 text-center">
                    <span className="text-xs font-mono font-bold text-sky-300">{emailInput}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5 text-center">
                      Código de Seguridad (6 dígitos)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full py-3 px-4 bg-gray-900/90 border border-gray-700 rounded-lg text-2xl text-center text-white tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-bold"
                      required
                      autoFocus
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5 text-center">
                      Expira en 10 minutos. Revisa tu bandeja de entrada o spam.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || codeInput.length !== 6}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Lock size={14} />
                    <span>{loading ? "Verificando..." : "Verificar y Entrar"}</span>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: Private Admin Key */}
          {authMode === "admin_key" && (
            <form onSubmit={handleLoginAdminKey} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center justify-between">
                  <span>Clave de Administración Corporativa</span>
                  <span className="text-[10px] text-purple-400 font-mono">WPIPE-ADM-...</span>
                </label>
                <input
                  type="text"
                  value={adminKeyInput}
                  onChange={(e) => setAdminKeyInput(e.target.value)}
                  placeholder="WPIPE-ADM-XXXX-XXXX"
                  className="w-full px-3.5 py-2.5 bg-gray-900/90 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-mono uppercase"
                  required
                  autoFocus
                />
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  Esta clave privada solo la recibe el director o comprador en su recibo de compra. Otorga control total sobre la liberación de asientos.
                </p>
              </div>

              <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-[11px] text-amber-200/90 flex items-start gap-2">
                <Lock size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Aviso de Seguridad:</strong> Las claves de terminal (VS Code tipo <code>WPIPE-PRO-...</code>) no tienen acceso a este portal. Si eres empleado, usa tu clave directamente en el plugin.
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Key size={14} />
                <span>{loading ? "Autenticando..." : "Acceder con Clave Maestra"}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW 2: Enterprise Dashboard (Multi-License Capable)
  // ---------------------------------------------------------------------------
  const orgLicenses = data.organization_licenses || [];
  const percentUsed = Math.min(100, Math.round((data.active_seats / data.max_seats) * 100));

  // Compute organization-wide aggregate metrics
  const orgTotalSeats = orgLicenses.reduce((acc, l) => acc + l.max_seats, 0) || data.max_seats;
  const orgTotalActive = orgLicenses.reduce((acc, l) => acc + l.active_seats, 0) || data.active_seats;
  const orgTotalAvailable = Math.max(0, orgTotalSeats - orgTotalActive);

  return (
    <div className="min-h-screen bg-[#07090e] text-gray-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-gray-800/80 bg-[#0c1220]/90 backdrop-blur-md px-6 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-black text-white text-sm shadow-md">
            W
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base tracking-tight text-white">
                WPipe Studio
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800 font-mono font-bold uppercase">
                {data.plan}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {data.customer_name} ({data.customer_email})
            </p>
          </div>
        </div>

        {/* Multi-License Selector Dropdown & Actions */}
        <div className="flex items-center gap-3">
          {orgLicenses.length > 1 && (
            <div className="flex items-center gap-2 bg-gray-900 border border-sky-800/60 rounded-lg px-2.5 py-1">
              <Building2 size={14} className="text-sky-400 shrink-0" />
              <label htmlFor="license-select" className="text-[11px] text-gray-400 font-medium whitespace-nowrap">
                Licencia:
              </label>
              <select
                id="license-select"
                value={data.license_key}
                onChange={(e) => handleSwitchLicense(e.target.value)}
                className="bg-transparent text-xs text-white font-mono focus:outline-none cursor-pointer"
              >
                {orgLicenses.map((lic) => (
                  <option key={lic.id} value={lic.license_key} className="bg-gray-900 text-white">
                    {lic.license_key.slice(0, 16)}... ({lic.active_seats}/{lic.max_seats} en uso) [{lic.plan.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => fetchOverview(token, currentKey || undefined)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition cursor-pointer"
            title="Refrescar estado en vivo"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/60 text-xs text-red-300 transition cursor-pointer"
          >
            <LogOut size={14} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {/* Banner Action Notice */}
        {actionNotice && (
          <div className="p-3.5 bg-emerald-950/80 border border-emerald-700 rounded-xl text-xs text-emerald-200 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>{actionNotice}</span>
            </div>
            <button
              onClick={() => setActionNotice(null)}
              className="text-xs text-emerald-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Organization-Wide Summary (When multiple licenses exist) */}
        {orgLicenses.length > 1 && (
          <div className="p-4 bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-purple-950/30 border border-sky-800/50 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-sky-500/20 border border-sky-400/30 rounded-xl text-sky-400">
                <Layers size={22} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Organización: {data.customer_name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-sky-900/80 text-sky-300 border border-sky-700 font-mono">
                    {orgLicenses.length} licencias contratadas
                  </span>
                </h3>
                <p className="text-xs text-gray-300 mt-0.5">
                  Consolidado global de la empresa: <strong>{orgTotalActive}</strong> de <strong>{orgTotalSeats}</strong> asientos en uso ({orgTotalAvailable} disponibles para nuevos empleados).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-gray-400">Licencia activa:</span>
              <code className="text-xs font-mono font-bold text-sky-300 bg-sky-950/80 px-2.5 py-1 rounded border border-sky-700/80 flex items-center gap-1.5">
                <span>{data.license_key}</span>
                <button
                  type="button"
                  onClick={() => handleCopyKey(data.license_key)}
                  className="hover:text-white cursor-pointer"
                  title="Copiar clave"
                >
                  <Copy size={12} />
                </button>
              </code>
              {copiedKey === data.license_key && (
                <span className="text-[11px] text-emerald-400 font-semibold animate-in fade-in">¡Copiada!</span>
              )}
            </div>
          </div>
        )}

        {/* Seat Speedometer & Stats Overview for Active License */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
            <span className="text-xs text-gray-400 font-medium">Plan de esta Licencia</span>
            <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-300 mt-1 uppercase">
              {data.plan}
            </div>
            <span className="text-[11px] text-gray-500 font-mono mt-1 block">
              {data.expires_at ? `Expira: ${data.expires_at.slice(0, 10)}` : "Vitalicia (Lifetime)"}
            </span>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
            <span className="text-xs text-gray-400 font-medium">Asientos Contratados</span>
            <div className="text-2xl font-black text-white mt-1">
              {data.max_seats}
            </div>
            <span className="text-[11px] text-gray-500 mt-1 block">
              Puestos simultáneos Pro
            </span>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg">
            <span className="text-xs text-gray-400 font-medium">Asientos en Uso Activo</span>
            <div className="text-2xl font-black text-amber-400 mt-1">
              {data.active_seats}
            </div>
            <span className="text-[11px] text-gray-500 mt-1 block">
              {percentUsed}% de capacidad ocupada
            </span>
          </div>

          <div className="bg-[#0f172a] border border-emerald-900/50 bg-emerald-950/20 rounded-xl p-5 shadow-lg">
            <span className="text-xs text-emerald-400 font-medium">Asientos Disponibles</span>
            <div className="text-2xl font-black text-emerald-300 mt-1">
              {data.available_seats}
            </div>
            <span className="text-[11px] text-emerald-500/80 mt-1 block">
              Listos para nuevos equipos
            </span>
          </div>
        </div>

        {/* Progress bar of seat utilization */}
        <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-4 shadow-lg">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5 font-medium">
            <span>Uso de Asientos Flotantes: {data.active_seats} de {data.max_seats}</span>
            <span>{percentUsed}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                percentUsed >= 100
                  ? "bg-red-500"
                  : percentUsed >= 80
                  ? "bg-amber-400"
                  : "bg-emerald-400"
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
        </div>

        {/* Connected Workstations Table */}
        <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Laptop size={18} className="text-sky-400" />
                <span>Equipos Conectados en Tiempo Real</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Cada ordenador activo envía un pulso (heartbeat) cada 30 min. Si un equipo se rompe o se formatea, libéralo aquí.
              </p>
            </div>
            <span className="text-xs text-gray-400 font-mono">
              {data.devices.length} equipo{data.devices.length === 1 ? "" : "s"} registrado{data.devices.length === 1 ? "" : "s"}
            </span>
          </div>

          {data.devices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="pb-3 font-semibold">Nombre del Equipo</th>
                    <th className="pb-3 font-semibold">Sistema Operativo</th>
                    <th className="pb-3 font-semibold">Último Heartbeat</th>
                    <th className="pb-3 font-semibold">Estado</th>
                    <th className="pb-3 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {data.devices.map((dev) => (
                    <tr key={dev.id} className="hover:bg-gray-800/30 transition">
                      <td className="py-3.5 font-bold text-white">
                        {dev.hostname || "Estación de Trabajo"}
                      </td>
                      <td className="py-3.5 text-gray-300">
                        {dev.os_name || "Desconocido"}
                      </td>
                      <td className="py-3.5 text-gray-400 flex items-center gap-1.5">
                        <Clock size={12} className="text-gray-500" />
                        <span>{dev.last_heartbeat_at}</span>
                      </td>
                      <td className="py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1 w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          En Línea (Pro)
                        </span>
                      </td>
                      <td className="py-3.5 text-right font-sans">
                        <button
                          onClick={() => handleLiberateSeat(dev.id, dev.hostname)}
                          disabled={loading}
                          className="px-3 py-1 bg-red-950/70 hover:bg-red-900 border border-red-700/80 rounded-lg text-xs font-semibold text-red-200 transition cursor-pointer disabled:opacity-50"
                        >
                          🔓 Liberar Asiento
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10 bg-gray-900/40 rounded-lg border border-dashed border-gray-800">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
              <h4 className="text-sm font-semibold text-white">Todos los Asientos de esta Licencia están Libres</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                No hay equipos usando esta clave en este momento. Abre VS Code en cualquier ordenador para activar el primer puesto.
              </p>
            </div>
          )}
        </div>

        {/* All Organization Licenses Cards */}
        {orgLicenses.length > 0 && (
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Building2 size={18} className="text-indigo-400" />
                  <span>Claves Corporativas de tu Organización ({orgLicenses.length})</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Entrega la clave de terminal a tus empleados. Guarda la clave de administración en privado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminKeys(!showAdminKeys)}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold cursor-pointer w-fit"
              >
                <Key size={13} />
                <span>{showAdminKeys ? "Ocultar Claves Admin" : "Mostrar Claves Admin"}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {orgLicenses.map((lic) => {
                const isSelected = lic.license_key === data.license_key;
                return (
                  <div
                    key={lic.id}
                    className={`p-4 rounded-xl border transition ${
                      isSelected
                        ? "bg-sky-950/40 border-sky-500 shadow-md shadow-sky-500/10"
                        : "bg-gray-900/70 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-gray-800 text-gray-300">
                        {lic.plan}
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">
                        {lic.active_seats} / {lic.max_seats} en uso
                      </span>
                    </div>

                    {/* Terminal Key for Employees */}
                    <div className="mt-2.5">
                      <span className="text-[10px] text-gray-400 font-medium block">
                        Clave de Puesto (VS Code empleados):
                      </span>
                      <div className="flex items-center justify-between mt-0.5">
                        <code className="text-xs font-mono font-bold text-white truncate max-w-[200px]">
                          {lic.license_key}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyKey(lic.license_key)}
                          className="text-gray-400 hover:text-white cursor-pointer ml-1 p-1"
                          title="Copiar clave de puesto"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Admin Key (Secret for IT Director) */}
                    {showAdminKeys && lic.admin_key && (
                      <div className="mt-2 pt-2 border-t border-gray-800/60">
                        <span className="text-[10px] text-purple-400 font-medium block flex items-center gap-1">
                          <Lock size={10} />
                          <span>Clave de Administración (Privada):</span>
                        </span>
                        <div className="flex items-center justify-between mt-0.5">
                          <code className="text-[11px] font-mono font-bold text-purple-300 truncate max-w-[200px]">
                            {lic.admin_key}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyKey(lic.admin_key!)}
                            className="text-gray-400 hover:text-purple-300 cursor-pointer ml-1 p-1"
                            title="Copiar clave de administración"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    )}

                    <span className="text-[10px] text-gray-500 mt-2 block">
                      {lic.expires_at ? `Expira: ${lic.expires_at.slice(0, 10)}` : "Vitalicia (Lifetime)"}
                    </span>

                    <div className="mt-3 pt-2.5 border-t border-gray-800/80 flex items-center justify-between">
                      {isSelected ? (
                        <span className="text-xs font-semibold text-sky-400 flex items-center gap-1">
                          <CheckCircle2 size={13} />
                          <span>Activa ahora</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitchLicense(lic.license_key)}
                          className="text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                        >
                          Gestionar esta clave →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Advice & Expansion Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg flex items-start gap-3">
            <HelpCircle size={20} className="text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-white">¿Se ha estropeado un ordenador o rotado un empleado?</h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Pulsa <strong>"Liberar Asiento"</strong> en la tabla superior. El puesto se liberará en 1 segundo y el nuevo empleado podrá utilizar la licencia Pro sin trámites.
              </p>
            </div>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg flex items-start gap-3">
            <PlusCircle size={20} className="text-purple-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-white">¿Necesitas más asientos para tu equipo?</h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Puedes añadir asientos adicionales a esta misma clave sin cambiar de licencia. Lemon Squeezy prorratea automáticamente los días restantes del mes.
              </p>
              <a
                href="https://wisrovi.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-semibold mt-2"
              >
                <span>Ampliar puestos en Lemon Squeezy</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
