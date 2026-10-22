import React, { useState } from "react";
import { EngineStatus } from "../lib/engineBridge";
import { ConnectEngineModal } from "./ConnectEngineModal";

interface EngineStatusWidgetProps {
  status: EngineStatus;
  onRecheck: (port?: number) => void;
  showProBadge?: boolean;
}

export const LicenseProBadge: React.FC<{ status: EngineStatus; onClick?: () => void }> = ({
  status,
  onClick,
}) => {
  if (!status.isPro) return null;
  return (
    <button
      onClick={onClick}
      className="flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm transition cursor-pointer"
      title={`Licencia Pro activa para ${status.customerName || "Enterprise"} (Click para detalles)`}
    >
      <span>👑</span>
      <span className="font-extrabold tracking-wide">PRO</span>
    </button>
  );
};

export const EngineStatusWidget: React.FC<EngineStatusWidgetProps> = ({
  status,
  onRecheck,
  showProBadge = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center space-x-2">
        {/* Engine Connectivity Button */}
        <button
          onClick={() => setModalOpen(true)}
          className={`flex items-center space-x-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
            status.connected
              ? "bg-emerald-950/50 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60"
              : "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700/80"
          }`}
          title={status.connected ? "Motor local wpipe-engine activo" : "Motor local desconectado (Click para conectar)"}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              status.connected
                ? "bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse"
                : "bg-slate-500"
            }`}
          />
          <span className="hidden sm:inline">
            {status.connected
              ? `Engine Local (${status.stepsCount} steps)`
              : "Modo Diseño"}
          </span>
          {status.connected && status.verifiedCryptographically && (
            <span className="text-[10px] text-emerald-400 font-mono" title="Firma Criptográfica Ed25519 Verificada">
              🛡️
            </span>
          )}
        </button>

        {/* Optional inline badge if showProBadge is true */}
        {showProBadge && status.isPro && (
          <LicenseProBadge status={status} onClick={() => setModalOpen(true)} />
        )}
      </div>

      <ConnectEngineModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        status={status}
        onRecheck={onRecheck}
      />
    </>
  );
};
