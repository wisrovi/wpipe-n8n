import React, { useEffect } from "react";
import { ShieldCheck, Check, Sparkles, X, Award, Cpu, Database, Zap, Terminal } from "lucide-react";
import { EngineStatus } from "../lib/engineBridge";

interface ProLicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: EngineStatus;
}

export const ProLicenseModal: React.FC<ProLicenseModalProps> = ({
  isOpen,
  onClose,
  status,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#0b0f19] border border-amber-500/60 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 my-auto text-gray-100 font-sans">
        {/* Header */}
        <div className="p-6 border-b border-gray-800/80 bg-gradient-to-r from-amber-950/40 via-[#0b0f19] to-purple-950/40 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-300 flex items-center justify-center text-xl shadow-lg shadow-amber-500/20 text-gray-950">
              👑
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 font-heading">
                  WPipe Studio PRO
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  ENTERPRISE ACTIVE
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Wisrovi Architect Suite & Verified Execution Engine
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800/60 transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* License Metadata Card */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh] custom-modal-scrollbar text-xs">
          <div className="bg-gray-900/90 border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-gray-800">
              <span className="text-gray-400">Licensee / Organization</span>
              <span className="font-bold text-gray-100 flex items-center gap-1.5">
                <Award size={13} className="text-amber-400" />
                <span>{status.customerName || "William Rodriguez (wisrovi.dev)"}</span>
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pb-2 border-b border-gray-800">
              <span className="text-gray-400">License Status</span>
              <span className="font-mono text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck size={13} />
                <span>Verified Cryptographically (Ed25519)</span>
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pb-2 border-b border-gray-800">
              <span className="text-gray-400">License Tier</span>
              <span className="font-mono text-amber-300 font-semibold">
                Enterprise Architect (Unlimited)
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Validity & Upgrades</span>
              <span className="font-mono text-sky-300">Lifetime Developer Access</span>
            </div>
          </div>

          {/* Unlocked Capabilities */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-400" />
              <span>Unlocked Pro Capabilities</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">197+ Step Catalog</div>
                  <div className="text-[11px] text-gray-400">All official packs + community plugins (YOLO, AI, etc.)</div>
                </div>
              </div>

              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">Production Scaffolding</div>
                  <div className="text-[11px] text-gray-400">35 production files, 100% compliant with wpipe-mcp</div>
                </div>
              </div>

              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">Real-Time Simulation</div>
                  <div className="text-[11px] text-gray-400">Interactive execution with live context mutation inspector</div>
                </div>
              </div>

              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">Full Control C-Blocks</div>
                  <div className="text-[11px] text-gray-400">Condition, For, While, Parallel (accumulate), Background</div>
                </div>
              </div>

              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">Deterministic Code Quality</div>
                  <div className="text-[11px] text-gray-400">Black, isort, mypy & Google docstrings without external API keys</div>
                </div>
              </div>

              <div className="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-2.5">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-gray-200">Hybrid Storage</div>
                  <div className="text-[11px] text-gray-400">Persistent sync between local disk (~/.wpipe) & browser</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 bg-gray-950/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <a
              href="https://portal.wisrovi.dev"
              target="_blank"
              rel="noopener"
              className="px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-emerald-500/40 text-emerald-300 font-semibold transition flex items-center gap-1.5"
            >
              <span>🔑</span>
              <span>License Portal</span>
            </a>
            {!status.isPro && (
              <a
                href="https://wisrovi.lemonsqueezy.com/checkout/buy/b2c96716-71a7-4df5-9d58-1ea58e1a5d96"
                target="_blank"
                rel="noopener"
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-gray-950 font-bold transition shadow-sm flex items-center gap-1.5"
              >
                <span>👑</span>
                <span>Buy Pro</span>
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-lg border border-gray-700 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
