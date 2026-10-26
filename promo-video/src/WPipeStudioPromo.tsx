import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  staticFile,
  Img,
} from "remotion";

export const WPipeStudioPromo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#07090e",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* SCENE 1: HERO INTRO (0 - 90 frames / 0 - 3s) */}
      <Sequence from={0} durationInFrames={90}>
        <IntroScene />
      </Sequence>

      {/* SCENE 2: BIDIRECTIONALITY & NATIVE VSCODE CANVAS (90 - 240 frames / 3 - 8s) */}
      <Sequence from={90} durationInFrames={150}>
        <BidirectionalScene />
      </Sequence>

      {/* SCENE 3: CUSTOM PYTHON STEPS & ZERO IFRAME (240 - 390 frames / 8 - 13s) */}
      <Sequence from={240} durationInFrames={150}>
        <CustomStepScene />
      </Sequence>

      {/* SCENE 4: OUTRO & PRO LICENSE (390 - 450 frames / 13 - 15s) */}
      <Sequence from={390} durationInFrames={60}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleProgress = spring({ frame, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [0, 20, 75, 90], [0, 1, 1, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        opacity,
        background: "radial-gradient(circle at center, #1e1b4b 0%, #07090e 70%)",
      }}
    >
      <div
        style={{
          transform: `scale(${titleProgress})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 78,
            fontWeight: 900,
            letterSpacing: "-2px",
            background: "linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 20,
          }}
        >
          WPipe Studio for VS Code
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#94a3b8",
            fontWeight: 500,
            maxWidth: 900,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          El Santo Grial de los Pipelines de Inteligencia Artificial
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 16,
          }}
        >
          <Badge label="Nativo VS Code" color="#38bdf8" />
          <Badge label="100% Bi-direccional" color="#10b981" />
          <Badge label="Licencia Pro Activa" color="#a855f7" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const BidirectionalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = interpolate(frame, [0, 30], [0.95, 1], { extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 20, 130, 150], [0, 1, 1, 0]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        padding: 50,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
        <div>
          <span style={{ fontSize: 44, fontWeight: 800, color: "#38bdf8" }}>
            Sincronización Bi-direccional Real
          </span>
          <p style={{ fontSize: 22, color: "#94a3b8", margin: 0, marginTop: 8 }}>
            Código Python ↔ Bloques Visuales en Tiempo Real
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Badge label="Auto-detecta app/states/*.py" color="#34d399" />
          <Badge label="Reconstruye app/pipelines.py" color="#60a5fa" />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          borderRadius: 16,
          overflow: "hidden",
          border: "2px solid #334155",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          transform: `scale(${scale})`,
        }}
      >
        <Img
          src={staticFile("canvas_view.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const CustomStepScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 20, 130, 150], [0, 1, 1, 0]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        padding: 60,
        background: "radial-gradient(circle at 80% 20%, #1e293b 0%, #07090e 80%)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 60,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ color: "#2dd4bf", fontSize: 24, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>
          Distinción de Orígenes
        </div>
        <h2 style={{ fontSize: 52, fontWeight: 900, marginTop: 12, lineHeight: 1.2 }}>
          Custom Python Steps vs. Catálogo Oficial
        </h2>
        <p style={{ fontSize: 24, color: "#94a3b8", lineHeight: 1.6, marginTop: 20 }}>
          Crea un estado con el <strong style={{ color: "#f8fafc" }}>Wizard</strong> o edita tus archivos en <code style={{ color: "#38bdf8" }}>app/states/</code>.
          El lienzo lo reconoce al instante como <strong style={{ color: "#2dd4bf" }}>Paso Personalizado (.py)</strong> sin tocar repos externos.
        </p>

        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
          <FeatureItem text="Cero iframes a la web externa: Ejecución 100% nativa local" />
          <FeatureItem text="Lienzo limpio adaptado a VS Code sin tabs redundantes" />
          <FeatureItem text="Acciones en Sidebar: Iniciar Engine, Licencia Pro, Preview DAG" />
        </div>
      </div>

      <div
        style={{
          flex: 1.1,
          height: 600,
          borderRadius: 20,
          overflow: "hidden",
          border: "2px solid #2dd4bf",
          boxShadow: "0 20px 40px rgba(45, 212, 191, 0.2)",
        }}
      >
        <Img
          src={staticFile("canvas_view.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "left top",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        background: "radial-gradient(circle at center, #1e1b4b 0%, #07090e 70%)",
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 900, color: "#f8fafc" }}>
        WPipe Studio VS Code
      </div>
      <div style={{ fontSize: 28, color: "#38bdf8", marginTop: 16 }}>
        wisrovi.dev • William Rodriguez
      </div>
      <div style={{ marginTop: 40, display: "flex", gap: 20 }}>
        <Badge label="23 Librerías Oficiales" color="#818cf8" />
        <Badge label="Open VSX & Marketplace" color="#34d399" />
      </div>
    </AbsoluteFill>
  );
};

const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <div
    style={{
      backgroundColor: `${color}15`,
      border: `1.5px solid ${color}`,
      color: color,
      borderRadius: 9999,
      padding: "10px 24px",
      fontSize: 18,
      fontWeight: 700,
    }}
  >
    {label}
  </div>
);

const FeatureItem: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        backgroundColor: "#2dd4bf20",
        color: "#2dd4bf",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        fontSize: 16,
      }}
    >
      ✓
    </div>
    <div style={{ fontSize: 22, color: "#cbd5e1", fontWeight: 500 }}>{text}</div>
  </div>
);
