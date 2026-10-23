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
  Download,
  Search,
  Tag,
  Terminal,
  UserPlus,
  QrCode,
  AlertCircle,
  Sparkles,
  Radio,
  Eye,
  EyeOff,
  Trash2,
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
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAdminKeys, setShowAdminKeys] = useState<boolean>(false);
  const [maskKeys, setMaskKeys] = useState<boolean>(true);
  const [deviceSearch, setDeviceSearch] = useState<string>("");
  const [editingNickId, setEditingNickId] = useState<string | null>(null);
  const [nickInput, setNickInput] = useState<string>("");
  const [inviteModalOpen, setInviteModalOpen] = useState<boolean>(false);
  const [autoRefreshRate, setAutoRefreshRate] = useState<number>(0); // 0 = off, 15, 30
  const [pollCountdown, setPollCountdown] = useState<number>(0);
  const [nicknames, setNicknames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("wpipe_station_nicknames") || "{}");
    } catch {
      return {};
    }
  });

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const formatRelativeTime = (dateStr: string): string => {
    if (!dateStr) return "Unknown";
    const now = new Date().getTime();
    const past = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - past) / 1000);
    if (isNaN(diffSec) || diffSec < 0) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const maskLicenseKey = (key: string): string => {
    if (!maskKeys) return key;
    const parts = key.split("-");
    if (parts.length <= 2) return key;
    return `${parts[0]}-${parts[1]}-••••-••••`;
  };

  const handleSaveNickname = (deviceId: string) => {
    const updated = { ...nicknames, [deviceId]: nickInput.trim() };
    setNicknames(updated);
    localStorage.setItem("wpipe_station_nicknames", JSON.stringify(updated));
    setEditingNickId(null);
  };

  const exportDevicesToCsv = (devicesToExport: Device[]) => {
    if (!devicesToExport || devicesToExport.length === 0) return;
    const csvRows = [
      "ID,Hostname,Nickname,Operating System,SHA-256 Fingerprint,Last Heartbeat,Expires",
      ...devicesToExport.map((d) =>
        `"${d.id}","${d.hostname || ""}","${nicknames[d.id] || ""}","${d.os_name || ""}","${d.machine_fingerprint}","${d.last_heartbeat_at}","${d.lease_expires_at}"`
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `wpipe_workstations_${data?.license_key || "export"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportDevicesToJson = (devicesToExport: Device[]) => {
    const enriched = devicesToExport.map((d) => ({
      ...d,
      nickname: nicknames[d.id] || null,
    }));
    const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `wpipe_workstations_${data?.license_key || "export"}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleLiberateAllSeats = async () => {
    if (!token || !data || data.devices.length === 0) return;
    const confirmAll = window.confirm(
      `Do you want to liberate all (${data.devices.length}) active workstations? All connected machines will be disconnected immediately and seats will become free.`
    );
    if (!confirmAll) return;

    setLoading(true);
    try {
      await Promise.all(
        data.devices.map((d) =>
          fetch(`${API_BASE}/v1/portal/seats/${d.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
      showToast("All seats have been liberated successfully.");
      await fetchOverview(token, currentKey || undefined);
    } catch (err: any) {
      showToast(err.message || "Failed to liberate all seats.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLiberateStaleSeats = async () => {
    if (!token || !data || data.devices.length === 0) return;
    const now = Date.now();
    const staleDevices = data.devices.filter((d) => {
      const past = new Date(d.last_heartbeat_at).getTime();
      return isNaN(past) || (now - past) > 3600000; // > 1 hour
    });

    if (staleDevices.length === 0) {
      showToast("All connected workstations are actively reporting heartbeats.", "info");
      return;
    }

    const confirmStale = window.confirm(
      `Found ${staleDevices.length} workstation(s) without a heartbeat in the last hour. Liberate them now?`
    );
    if (!confirmStale) return;

    setLoading(true);
    try {
      await Promise.all(
        staleDevices.map((d) =>
          fetch(`${API_BASE}/v1/portal/seats/${d.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
      showToast(`Liberated ${staleDevices.length} inactive workstation(s).`);
      await fetchOverview(token, currentKey || undefined);
    } catch (err: any) {
      showToast(err.message || "Failed to liberate stale seats.", "error");
    } finally {
      setLoading(false);
    }
  };

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
        throw new Error(errJson.message || "Unable to load license details.");
      }
      const json: LicenseOverview = await res.json();
      setData(json);
      setCurrentKey(json.license_key);
      localStorage.setItem("wpipe_active_key", json.license_key);
    } catch (err: any) {
      setError(err.message || "Error connecting to authorization authority.");
      if (err.message && (err.message.includes("UNAUTHORIZED") || err.message.includes("expired"))) {
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
        throw new Error(json.message || "Failed to dispatch verification code.");
      }

      setOtpStep("code");
      setInfoNotice(`A 6-digit security code has been sent to ${cleanEmail}`);
      showToast(`Security code dispatched to ${cleanEmail}`);
    } catch (err: any) {
      setError(err.message || "Error requesting OTP security code.");
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
        throw new Error(json.message || "Invalid or expired security code.");
      }

      localStorage.setItem("wpipe_portal_session_token", json.token);
      setToken(json.token);
      fetchOverview(json.token);
    } catch (err: any) {
      setError(err.message || "Error verifying security code.");
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
        throw new Error(json.message || "Invalid admin key.");
      }

      localStorage.setItem("wpipe_portal_session_token", json.token);
      setToken(json.token);
      fetchOverview(json.token);
    } catch (err: any) {
      setError(err.message || "Authentication error.");
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
    setInfoNotice(null);
  };

  const handleSwitchLicense = (newKey: string) => {
    if (!token || newKey === currentKey) return;
    fetchOverview(token, newKey);
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    showToast("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleLiberateSeat = async (leaseId: string, hostname: string | null) => {
    if (!token) return;
    const confirmKick = window.confirm(
      `Do you want to release the workstation "${hostname || "Workstation"}" immediately? Another computer will be able to claim this seat instantly.`
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
        throw new Error("Could not release seat.");
      }
      showToast(`Workstation "${hostname || "Workstation"}" seat successfully liberated.`);
      await fetchOverview(token, currentKey || undefined);
    } catch (err: any) {
      showToast(err.message || "Error liberating seat.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token || autoRefreshRate <= 0) return;
    setPollCountdown(autoRefreshRate);
    const interval = setInterval(() => {
      setPollCountdown((prev) => {
        if (prev <= 1) {
          fetchOverview(token, currentKey || undefined);
          return autoRefreshRate;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [token, currentKey, autoRefreshRate]);

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
              <span>Enterprise Customer Self-Service Portal</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Corporate license governance, real-time workstation telemetry, and seat allocation.
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
              <span>Email (OTP)</span>
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
              <span>Admin Key</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/80 border border-red-700/80 rounded-lg text-xs text-red-200 flex items-start gap-2">
              <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {infoNotice && (
            <div className="mb-4 p-3 bg-sky-950/80 border border-sky-700/80 rounded-lg text-xs text-sky-200 flex items-start gap-2">
              <CheckCircle2 size={15} className="text-sky-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{infoNotice}</span>
            </div>
          )}

          {/* TAB 1: Passwordless Email OTP */}
          {authMode === "otp" && (
            <div>
              {otpStep === "email" ? (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center justify-between">
                      <span>Buyer Corporate Email</span>
                      <span className="text-[10px] text-gray-500 font-normal">Passwordless</span>
                    </label>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="it-admin@enterprise.com"
                      className="w-full px-3.5 py-2.5 bg-gray-900/90 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-sans"
                      required
                      autoFocus
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                      We will dispatch a 6-digit one-time security code to verify domain mailbox ownership.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Send size={14} />
                    <span>{loading ? "Sending code..." : "Send Verification Code"}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Verifying:</span>
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
                      <span>Change email</span>
                    </button>
                  </div>

                  <div className="p-2.5 bg-gray-900/80 rounded-lg border border-gray-800 text-center">
                    <span className="text-xs font-mono font-bold text-sky-300">{emailInput}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5 text-center">
                      Security Code (6 digits)
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
                      Expires in 10 minutes. Please check your inbox or spam folder.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || codeInput.length !== 6}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Lock size={14} />
                    <span>{loading ? "Verifying..." : "Verify & Access Portal"}</span>
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
                  <span>Corporate Admin Key</span>
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
                  Private sovereign key issued on your purchase invoice. Grants instant seat revocation privileges.
                </p>
              </div>

              <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-[11px] text-amber-200/90 flex items-start gap-2">
                <Lock size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Security Note:</strong> Terminal workstation keys (e.g. <code>WPIPE-PRO-...</code>) cannot log into this administrative portal. Use your terminal key inside the VS Code extension.
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Key size={14} />
                <span>{loading ? "Authenticating..." : "Sign In with Admin Key"}</span>
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
        <div className="flex items-center gap-2.5">
          {orgLicenses.length > 1 && (
            <div className="flex items-center gap-2 bg-gray-900 border border-sky-800/60 rounded-lg px-2.5 py-1">
              <Building2 size={14} className="text-sky-400 shrink-0" />
              <label htmlFor="license-select" className="text-[11px] text-gray-400 font-medium whitespace-nowrap">
                License:
              </label>
              <select
                id="license-select"
                value={data.license_key}
                onChange={(e) => handleSwitchLicense(e.target.value)}
                className="bg-transparent text-xs text-white font-mono focus:outline-none cursor-pointer"
              >
                {orgLicenses.map((lic) => (
                  <option key={lic.id} value={lic.license_key} className="bg-gray-900 text-white">
                    {lic.license_key.slice(0, 16)}... ({lic.active_seats}/{lic.max_seats} in use) [{lic.plan.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mask Key Toggle */}
          <button
            onClick={() => setMaskKeys(!maskKeys)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-300 hover:text-white transition cursor-pointer"
            title={maskKeys ? "Reveal Keys" : "Mask Keys for screen sharing"}
          >
            {maskKeys ? <EyeOff size={13} className="text-gray-400" /> : <Eye size={13} className="text-sky-400" />}
            <span className="hidden sm:inline">{maskKeys ? "Confidential" : "Visible"}</span>
          </button>

          {/* Auto Refresh Poller */}
          <div className="hidden sm:flex items-center gap-1.5 bg-gray-900/90 border border-gray-800 rounded-lg px-2 py-1 text-xs">
            <Radio size={12} className={autoRefreshRate > 0 ? "text-emerald-400 animate-pulse" : "text-gray-500"} />
            <select
              value={autoRefreshRate}
              onChange={(e) => setAutoRefreshRate(Number(e.target.value))}
              className="bg-transparent text-[11px] text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value={0} className="bg-gray-900 text-white">Manual Refresh</option>
              <option value={15} className="bg-gray-900 text-white">Auto 15s</option>
              <option value={30} className="bg-gray-900 text-white">Auto 30s</option>
            </select>
            {autoRefreshRate > 0 && (
              <span className="text-[10px] font-mono text-emerald-400 font-bold">{pollCountdown}s</span>
            )}
          </div>

          {/* Invite Developer Modal Trigger */}
          <button
            onClick={() => setInviteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition cursor-pointer shadow-md shadow-sky-600/20"
          >
            <UserPlus size={13} />
            <span className="hidden md:inline">Invite Developer</span>
            <span className="md:hidden">+ Invite</span>
          </button>

          {/* Direct VS Code Deep Link */}
          <a
            href={`vscode://wisrovi.wpipe-studio-vscode/activate?key=${encodeURIComponent(data.license_key)}`}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/80 text-xs font-semibold text-indigo-200 transition cursor-pointer"
            title="Open this workstation license directly in local VS Code"
          >
            <Sparkles size={13} className="text-indigo-400" />
            <span>Launch VS Code</span>
          </a>

          <button
            onClick={() => fetchOverview(token, currentKey || undefined)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition cursor-pointer"
            title="Refresh real-time telemetry"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span className="hidden xl:inline">Refresh</span>
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/60 text-xs text-red-300 transition cursor-pointer"
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">

        {/* Seat Saturation Warning Banner (If 100% full) */}
        {percentUsed >= 100 && (
          <div className="p-4 bg-red-950/70 border border-red-700 rounded-2xl flex items-center justify-between gap-4 text-xs text-red-200 shadow-xl animate-in fade-in">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-red-400 shrink-0" />
              <div>
                <strong className="text-white block font-bold">All Concurrency Seats are Currently Occupied</strong>
                <span>
                  All {data.max_seats} seat leases are held by active developers. To connect a new station, release an inactive workstation below or expand your plan.
                </span>
              </div>
            </div>
            <button
              onClick={handleLiberateStaleSeats}
              className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg font-semibold shrink-0 cursor-pointer shadow-md"
            >
              Liberate Inactive Seats
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
                  <span>Organization: {data.customer_name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-sky-900/80 text-sky-300 border border-sky-700 font-mono">
                    {orgLicenses.length} active licenses
                  </span>
                </h3>
                <p className="text-xs text-gray-300 mt-0.5">
                  Consolidated enterprise pool: <strong>{orgTotalActive}</strong> of <strong>{orgTotalSeats}</strong> seats occupied ({orgTotalAvailable} seats available for new teammates).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-gray-400">Active License:</span>
              <code className="text-xs font-mono font-bold text-sky-300 bg-sky-950/80 px-2.5 py-1 rounded border border-sky-700/80 flex items-center gap-1.5">
                <span>{maskLicenseKey(data.license_key)}</span>
                <button
                  type="button"
                  onClick={() => handleCopyKey(data.license_key)}
                  className="hover:text-white cursor-pointer"
                  title="Copy full key"
                >
                  <Copy size={12} />
                </button>
              </code>
              {copiedKey === data.license_key && (
                <span className="text-[11px] text-emerald-400 font-semibold animate-in fade-in">Copied!</span>
              )}
            </div>
          </div>
        )}

        {/* Seat Gauge, Developer Quick Snippet & Stats Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Radial Circular Seat Gauge Card */}
          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-gray-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={`transition-all duration-700 ${
                    percentUsed >= 100
                      ? "text-red-500"
                      : percentUsed >= 80
                      ? "text-amber-400"
                      : "text-sky-400"
                  }`}
                  strokeDasharray={`${percentUsed}, 100`}
                  strokeLinecap="round"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-sm font-black text-white">{percentUsed}%</span>
                <span className="text-[9px] text-gray-400 font-mono">utilized</span>
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-400 font-medium block">Floating Seats</span>
              <div className="text-lg font-black text-white mt-0.5">
                {data.active_seats} <span className="text-gray-500 text-xs font-normal">/ {data.max_seats}</span>
              </div>
              <span className="text-[11px] text-sky-400 font-mono block mt-0.5">
                {data.available_seats} available for team
              </span>
            </div>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-5 shadow-xl">
            <span className="text-xs text-gray-400 font-medium">Subscription Tier</span>
            <div className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-300 mt-1 uppercase">
              {data.plan}
            </div>
            <span className="text-[11px] text-gray-500 font-mono mt-1 block">
              {data.expires_at ? `Expires: ${data.expires_at.slice(0, 10)}` : "Perpetual (Lifetime)"}
            </span>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-5 shadow-xl">
            <span className="text-xs text-gray-400 font-medium">Concurrency Quota</span>
            <div className="text-xl font-black text-white mt-1">
              {data.max_seats} Simultaneous
            </div>
            <span className="text-[11px] text-gray-500 mt-1 block">
              Floating lease via 30m heartbeat
            </span>
          </div>

          <div className="bg-[#0f172a] border border-emerald-900/50 bg-emerald-950/20 rounded-2xl p-5 shadow-xl">
            <span className="text-xs text-emerald-400 font-medium">Licensing Authority</span>
            <div className="text-xl font-black text-emerald-300 mt-1 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>100% Operational</span>
            </div>
            <span className="text-[11px] text-emerald-500/80 mt-1 block font-mono">
              Cloudflare Edge Validated
            </span>
          </div>
        </div>

        {/* Download Center & Quick Setup */}
        <div className="bg-[#0f172a] border border-sky-800/40 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-400">
                <Download size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Direct Binaries & Offline Package Downloads</h3>
                <p className="text-xs text-gray-400">Zero-friction installation artifacts for air-gapped or developer workstations</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`${API_BASE}/v1/downloads/latest`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-md"
              >
                <Download size={13} />
                <span>Download Extension (.vsix)</span>
              </a>
              <a
                href={`${API_BASE}/v1/downloads/linux-x64/wpipe-engine`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Terminal size={13} />
                <span>CLI Engine (Linux)</span>
              </a>
            </div>
          </div>

          {/* Developer Quick Snippet Box */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                <Terminal size={18} />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  Workstation Terminal Activation Command
                </span>
                <p className="text-[11px] text-gray-400">
                  Run this single command on any developer computer to activate the floating Pro seat:
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <code className="text-xs font-mono text-sky-300 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800 flex-1 md:flex-none">
                wpipe license activate --key {maskLicenseKey(data.license_key)}
              </code>
              <button
                onClick={() => handleCopyKey(`wpipe license activate --key ${data.license_key}`)}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1 shrink-0"
              >
                <Copy size={12} />
                <span>{copiedKey?.includes("activate") ? "Copied!" : "Copy"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Connected Workstations Table with Search, Nicknames & Export */}
        <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Laptop size={18} className="text-sky-400" />
                <span>Connected Workstations ({data.devices.length})</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Automatic heartbeat every 30 minutes. Assign nicknames to easily recognize developer laptops.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-2.5 text-gray-500" />
                <input
                  type="text"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  placeholder="Filter by hostname, OS, nickname..."
                  className="pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              {data.devices.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportDevicesToCsv(data.devices)}
                    className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                    title="Export workstation inventory to CSV spreadsheet"
                  >
                    <Download size={13} />
                    <span>CSV</span>
                  </button>
                  <button
                    onClick={() => exportDevicesToJson(data.devices)}
                    className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                    title="Export structured JSON inventory"
                  >
                    <Download size={13} />
                    <span>JSON</span>
                  </button>
                  <button
                    onClick={handleLiberateStaleSeats}
                    disabled={loading}
                    className="px-2.5 py-1.5 bg-amber-950/70 hover:bg-amber-900 border border-amber-700/80 rounded-lg text-xs font-semibold text-amber-200 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    title="Liberate workstations with no heartbeat in the last hour"
                  >
                    <Clock size={13} className="text-amber-400" />
                    <span>Purge Stale</span>
                  </button>
                  <button
                    onClick={handleLiberateAllSeats}
                    disabled={loading}
                    className="px-2.5 py-1.5 bg-red-950/70 hover:bg-red-900 border border-red-700/80 rounded-lg text-xs font-semibold text-red-200 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    title="Disconnect all workstations immediately"
                  >
                    <Trash2 size={13} className="text-red-400" />
                    <span>Liberate All</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {data.devices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="pb-3 font-semibold">Workstation / Nickname</th>
                    <th className="pb-3 font-semibold">Operating System</th>
                    <th className="pb-3 font-semibold">Hardware Fingerprint</th>
                    <th className="pb-3 font-semibold">Last Heartbeat</th>
                    <th className="pb-3 font-semibold">Lease Status</th>
                    <th className="pb-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-mono">
                  {data.devices
                    .filter((dev) => {
                      if (!deviceSearch.trim()) return true;
                      const term = deviceSearch.toLowerCase();
                      const nick = (nicknames[dev.id] || "").toLowerCase();
                      const host = (dev.hostname || "").toLowerCase();
                      const os = (dev.os_name || "").toLowerCase();
                      const mfp = (dev.machine_fingerprint || "").toLowerCase();
                      return nick.includes(term) || host.includes(term) || os.includes(term) || mfp.includes(term);
                    })
                    .map((dev) => (
                      <tr key={dev.id} className="hover:bg-gray-800/30 transition">
                        <td className="py-3.5 text-white">
                          <div className="space-y-0.5">
                            <div className="font-bold flex items-center gap-1.5">
                              <span>{dev.hostname || "Developer Workstation"}</span>
                              {nicknames[dev.id] && (
                                <span className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-normal">
                                  {nicknames[dev.id]}
                                </span>
                              )}
                            </div>

                            {/* Inline Nickname Editor */}
                            {editingNickId === dev.id ? (
                              <div className="flex items-center gap-1 pt-1 font-sans">
                                <input
                                  type="text"
                                  value={nickInput}
                                  onChange={(e) => setNickInput(e.target.value)}
                                  placeholder="e.g. Alice's MacBook Pro..."
                                  className="px-2 py-0.5 bg-gray-900 border border-sky-600 rounded text-xs text-white"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveNickname(dev.id)}
                                  className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingNickId(null)}
                                  className="text-gray-400 hover:text-white text-[10px] px-1"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingNickId(dev.id);
                                  setNickInput(nicknames[dev.id] || "");
                                }}
                                className="text-[10px] text-gray-500 hover:text-sky-300 flex items-center gap-1 font-sans cursor-pointer"
                              >
                                <Tag size={10} />
                                <span>{nicknames[dev.id] ? "Edit nickname" : "+ Add nickname"}</span>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 text-gray-300">
                          {dev.os_name || "Linux"}
                        </td>
                        <td className="py-3.5 text-gray-400">
                          <code className="text-[11px] text-gray-400 bg-gray-900/80 px-1.5 py-0.5 rounded border border-gray-800">
                            {dev.machine_fingerprint.slice(0, 16)}...
                          </code>
                        </td>
                        <td className="py-3.5 text-gray-400">
                          <div className="flex items-center gap-1.5" title={dev.last_heartbeat_at}>
                            <Clock size={12} className="text-gray-500" />
                            <span className="font-sans font-medium text-gray-300">{formatRelativeTime(dev.last_heartbeat_at)}</span>
                          </div>
                          <span className="text-[10px] text-gray-500 font-mono block mt-0.5">
                            {dev.last_heartbeat_at.slice(11, 19)} UTC
                          </span>
                        </td>
                        <td className="py-3.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1 w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Online (Pro)
                          </span>
                        </td>
                        <td className="py-3.5 text-right font-sans">
                          <button
                            onClick={() => handleLiberateSeat(dev.id, dev.hostname)}
                            disabled={loading}
                            className="px-3 py-1 bg-red-950/70 hover:bg-red-900 border border-red-700/80 rounded-lg text-xs font-semibold text-red-200 transition cursor-pointer disabled:opacity-50"
                          >
                            Liberate Seat
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
              <h4 className="text-sm font-semibold text-white">All Seats for This License are Free</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                No active workstation is claiming this license right now. Open VS Code on any computer to activate the first station.
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
                  <span>Corporate License Keys in Your Organization ({orgLicenses.length})</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Distribute the workstation key to team members. Keep the private admin key secure.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminKeys(!showAdminKeys)}
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold cursor-pointer w-fit"
              >
                <Key size={13} />
                <span>{showAdminKeys ? "Hide Admin Keys" : "Show Admin Keys"}</span>
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
                        {lic.active_seats} / {lic.max_seats} in use
                      </span>
                    </div>

                    {/* Terminal Key for Employees */}
                    <div className="mt-2.5">
                      <span className="text-[10px] text-gray-400 font-medium block">
                        Workstation Key (VS Code developers):
                      </span>
                      <div className="flex items-center justify-between mt-0.5">
                        <code className="text-xs font-mono font-bold text-white truncate max-w-[200px]">
                          {maskLicenseKey(lic.license_key)}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyKey(lic.license_key)}
                          className="text-gray-400 hover:text-white cursor-pointer ml-1 p-1"
                          title="Copy workstation key"
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
                          <span>Private Administration Key:</span>
                        </span>
                        <div className="flex items-center justify-between mt-0.5">
                          <code className="text-[11px] font-mono font-bold text-purple-300 truncate max-w-[200px]">
                            {lic.admin_key}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyKey(lic.admin_key!)}
                            className="text-gray-400 hover:text-purple-300 cursor-pointer ml-1 p-1"
                            title="Copy administration key"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    )}

                    <span className="text-[10px] text-gray-500 mt-2 block">
                      {lic.expires_at ? `Expires: ${lic.expires_at.slice(0, 10)}` : "Perpetual (Lifetime)"}
                    </span>

                    <div className="mt-3 pt-2.5 border-t border-gray-800/80 flex items-center justify-between">
                      {isSelected ? (
                        <span className="text-xs font-semibold text-sky-400 flex items-center gap-1">
                          <CheckCircle2 size={13} />
                          <span>Currently Active</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSwitchLicense(lic.license_key)}
                          className="text-xs text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                        >
                          Manage This Key →
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
              <h4 className="text-sm font-bold text-white">Replacing a broken laptop or onboarding a new developer?</h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Click <strong>"Liberate Seat"</strong> in the table above. The seat will be returned immediately to the pool, and your new engineer can activate Pro without support tickets.
              </p>
            </div>
          </div>

          <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-5 shadow-lg flex items-start gap-3">
            <PlusCircle size={20} className="text-purple-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-white">Need more concurrent seats for your team?</h4>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                You can add extra seats to this same license key at any time. Lemon Squeezy automatically prorates the remaining days of your billing cycle.
              </p>
              <a
                href="https://wisrovi.dev"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-semibold mt-2"
              >
                <span>Expand seats at wisrovi.dev</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* Developer Invitation Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c1220] border border-sky-800/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-500/20 text-sky-400 rounded-xl border border-sky-500/30">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Invite Developer to Your Team</h3>
                  <p className="text-xs text-gray-400">Share floating Pro access to WPipe Studio</p>
                </div>
              </div>
              <button
                onClick={() => setInviteModalOpen(false)}
                className="text-gray-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Deep Link 1-click */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                <Sparkles size={14} />
                <span>Option 1: 1-Click Launch in VS Code</span>
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`vscode://wisrovi.wpipe-studio-vscode/activate?key=${data.license_key}`}
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white font-mono truncate"
                />
                <button
                  onClick={() => handleCopyKey(`vscode://wisrovi.wpipe-studio-vscode/activate?key=${data.license_key}`)}
                  className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Copy size={13} />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            {/* Terminal Command */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <Terminal size={14} className="text-indigo-400" />
                <span>Option 2: Terminal Command</span>
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-xs text-indigo-300 font-mono truncate">
                  wpipe license activate --key {data.license_key}
                </code>
                <button
                  onClick={() => handleCopyKey(`wpipe license activate --key ${data.license_key}`)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Copy size={13} />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            {/* Slack / Teams copyable template */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">Slack / Teams Invitation Template</span>
                <button
                  onClick={() => {
                    const tmpl = `👋 **WPipe Studio Pro Access Activated!**\nHi, your WPipe Studio Pro seat is ready:\n1. Install the official 'WPipe Studio' extension in VS Code.\n2. Click this direct link to claim your floating seat:\nvscode://wisrovi.wpipe-studio-vscode/activate?key=${data.license_key}\nOr activate via terminal: \`wpipe license activate --key ${data.license_key}\``;
                    handleCopyKey(tmpl);
                  }}
                  className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer font-normal"
                >
                  <Copy size={11} />
                  <span>Copy full template</span>
                </button>
              </div>
              <div className="p-3 bg-gray-950 border border-gray-800 rounded-lg text-[11px] font-mono text-gray-300 leading-relaxed max-h-24 overflow-y-auto">
                👋 WPipe Studio Pro Access Activated!<br/>
                1. Install the extension in VS Code.<br/>
                2. Click the link or activate with key:<br/>
                <strong className="text-sky-400 font-bold">{maskLicenseKey(data.license_key)}</strong>
              </div>
            </div>

            {/* QR Code */}
            <div className="pt-3 border-t border-gray-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    `vscode://wisrovi.wpipe-studio-vscode/activate?key=${data.license_key}`
                  )}`}
                  alt="QR Code"
                  className="w-16 h-16 rounded-lg bg-white p-1 border border-gray-700"
                />
                <div className="text-xs text-gray-400">
                  <span className="font-semibold text-white flex items-center gap-1">
                    <QrCode size={13} className="text-sky-400" />
                    <span>QR Code Scan</span>
                  </span>
                  <span>Quick camera scan for test tablets and workstations.</span>
                </div>
              </div>

              <button
                onClick={() => setInviteModalOpen(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification System */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 ${
            toastMessage.type === "error"
              ? "bg-red-950/95 border-red-700 text-red-200 shadow-red-950/50"
              : toastMessage.type === "info"
              ? "bg-sky-950/95 border-sky-700 text-sky-200 shadow-sky-950/50"
              : "bg-emerald-950/95 border-emerald-700 text-emerald-200 shadow-emerald-950/50"
          }`}
        >
          {toastMessage.type === "error" ? (
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
          ) : toastMessage.type === "info" ? (
            <AlertCircle size={18} className="text-sky-400 shrink-0" />
          ) : (
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-gray-400 hover:text-white text-sm ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
