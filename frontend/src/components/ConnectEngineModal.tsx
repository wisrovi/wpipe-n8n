import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { EngineStatus, DEFAULT_ENGINE_PORT } from "../lib/engineBridge";

interface ConnectEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: EngineStatus;
  onRecheck: (port?: number) => void;
}

export const ConnectEngineModal: React.FC<ConnectEngineModalProps> = ({
  isOpen,
  onClose,
  status,
  onRecheck,
}) => {
  const [port, setPort] = useState(status.port || DEFAULT_ENGINE_PORT);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const isVsCode =
    typeof (window as any).acquireVsCodeApi === "function" ||
    window.location.search.includes("mode=vscode") ||
    window.self !== window.top;

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const terminalCommand = `~/.wpipe/bin/wpipe-engine daemon`;
  const vsCodeDeepLink = `vscode://wisrovi.wpipe-studio-vscode/open`;

  const handleCopy = () => {
    navigator.clipboard.writeText(terminalCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    setChecking(true);
    try {
      await onRecheck(Number(port));
    } finally {
      setChecking(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                status.connected
                  ? "bg-emerald-500 shadow-lg shadow-emerald-500/50"
                  : "bg-amber-500 shadow-lg shadow-amber-500/50"
              } animate-pulse`}
            />
            <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
              {status.connected ? "Native Engine Connected" : "Connect Local wpipe-engine"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            title="Close modal (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Content Body with vertical scrolling if needed */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {status.connected ? (
            /* Connected state info */
            <div className="space-y-4">
              <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-emerald-400 text-sm font-semibold flex items-center space-x-1.5">
                    <span>⚡ Status: Active & Operational</span>
                    {status.verifiedCryptographically && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono border border-emerald-500/30">
                        🛡️ Ed25519 OK
                      </span>
                    )}
                  </div>
                  <div className="text-slate-300 text-xs mt-1">
                    PID: <span className="font-mono text-white">{status.pid || "Active"}</span> • Port:{" "}
                    <span className="font-mono text-white">{status.port}</span> • Catalog:{" "}
                    <span className="font-mono text-white">{status.stepsCount} steps</span>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                      status.isPro
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {status.tier}
                  </span>
                </div>
              </div>

              {status.isPro && (
                <div className="text-xs text-slate-300 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 space-y-1">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <span>👑</span>
                    <span>Pro License Active</span>
                  </div>
                  <div>
                    Licensee: <span className="text-white font-medium">{status.customerName}</span>. Unlimited blocks, concurrency, and AI generation enabled without restrictions.
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Disconnected state guide */
            <div className="space-y-4">
              <p className="text-sm text-slate-300 leading-relaxed">
                You are currently in <strong className="text-white">Design Mode</strong>. You can design, edit, and export pipelines. To{" "}
                <strong className="text-emerald-400">simulate and run zero-latency Python code locally</strong> without transmitting your data to external servers, start the native engine.
              </p>

              {/* In VS Code, show extension-native instruction; otherwise show Deep Link option */}
              {isVsCode ? (
                <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl p-4 space-y-2">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-2xl">⚡</span>
                    <div>
                      <div className="text-sm font-semibold text-white">Native VS Code Extension Mode</div>
                      <div className="text-xs text-slate-400">
                        The extension automatically manages <code className="text-emerald-400">wpipe-engine</code>. If it is stopped, press <kbd className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-gray-200">Ctrl+Shift+P</kbd> and run <span className="text-sky-400">WPipe: Start Native Engine</span>.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl p-4 hover:border-indigo-500/60 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <span className="text-2xl">💻</span>
                      <div>
                        <div className="text-sm font-semibold text-white">Option 1: Open in VS Code</div>
                        <div className="text-xs text-slate-400">Launches the background daemon and binds your local workspace</div>
                      </div>
                    </div>
                    <a
                      href={vsCodeDeepLink}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>Launch</span>
                      <span>↗</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Option: Terminal Daemon */}
              <div className="bg-slate-800/50 border border-slate-700/80 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-2xl">🚀</span>
                    <div>
                      <div className="text-sm font-semibold text-white">Start Daemon in Terminal</div>
                      <div className="text-xs text-slate-400">Run the compiled native wpipe-engine binary</div>
                    </div>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-all cursor-pointer"
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                <div className="bg-black/60 p-2.5 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 select-all overflow-x-auto">
                  {terminalCommand}
                </div>
              </div>

              {/* Port & Test Connection */}
              <div className="pt-2 flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400 font-medium">Port:</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleTestConnection}
                  disabled={checking}
                  className="flex-1 py-1.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  {checking ? (
                    <span>Checking...</span>
                  ) : (
                    <>
                      <span>🔄</span>
                      <span>Check Connection</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <a
              href="https://portal.wisrovi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 font-medium underline flex items-center gap-1"
            >
              <span>🔑</span>
              <span>Manage License</span>
            </a>
            <span className="text-slate-600">•</span>
            <a
              href="https://wpipe-studio.wisrovi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300 font-medium underline"
            >
              Installation Docs
            </a>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
