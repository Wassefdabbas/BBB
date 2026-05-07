import { useState, useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://bbb-pndk.onrender.com";

const EXAMPLES = [
  { name: "Aspirin",   smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { name: "Caffeine",  smiles: "Cn1c(=O)c2c(ncn2C)n(c1=O)C" },
  { name: "Ibuprofen", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O" },
  { name: "Dopamine",  smiles: "NCCc1ccc(O)c(O)c1" },
  { name: "Morphine",  smiles: "OC1=CC2=C(C=C1)C1CC3N(CC1CC3O2)C" },
];

function useTheme() {
  const [theme, setTheme] = useState("dark");
  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");
  return { theme, toggle };
}

export default function App() {
  const [smiles, setSmiles]               = useState("");
  const [phase, setPhase]                 = useState("idle");
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [scanProgress, setScanProgress]   = useState(0);
  const [moleculeImg, setMoleculeImg]     = useState(null);
  const [displayedConf, setDisplayedConf] = useState(0);
  const [hudVisible, setHudVisible]       = useState(false);
  const [molName, setMolName]             = useState(null);
  const [completedAt, setCompletedAt]     = useState(null);
  const [inputMode, setInputMode]         = useState("smiles");
  const [nameQuery, setNameQuery]         = useState("");
  const [nameLoading, setNameLoading]     = useState(false);
  const [nameError, setNameError]         = useState(null);
  const { theme, toggle: toggleTheme }    = useTheme();

  const canvasRef    = useRef(null);
  const animRef      = useRef(null);
  const particlesRef = useRef([]);

  const isDark = theme === "dark";

  // ── CSS vars injected once ─────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── Ensure correct mobile viewport meta ───────────────────────────────────
  useEffect(() => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    meta.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
  }, []);

  // ── Tron grid + particles ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let gridOffset = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      gridOffset = (gridOffset + 0.15) % 80;

      const gridAlpha = isDark ? 0.035 : 0.06;
      ctx.strokeStyle = isDark ? `rgba(0,180,255,${gridAlpha})` : `rgba(0,100,200,${gridAlpha})`;
      ctx.lineWidth = 1;
      for (let x = (gridOffset % 80) - 80; x < canvas.width + 80; x += 80) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height + 80; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      for (const p of particlesRef.current) {
        p.x += p.vx; p.y += p.vy; p.life -= 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${(p.life / 100).toFixed(2)})`;
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [isDark]);

  // ── Molecule name fetch ────────────────────────────────────────────────────
  async function fetchMolName(smilesStr) {
    try {
      const res = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr)}/synonyms/JSON`
      );
      if (!res.ok) return;
      const data = await res.json();
      const synonyms = data.InformationList?.Information?.[0]?.Synonym;
      if (synonyms?.length) setMolName(synonyms[0]);
    } catch { /* not found */ }
  }

  // ── Fetch SMILES from compound name ───────────────────────────────────────
  async function fetchSmilesByName(name) {
    setNameLoading(true);
    setNameError(null);
    try {
      const res = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name.trim())}/property/IsomericSMILES/JSON`
      );
      if (!res.ok) throw new Error(`Compound "${name}" not found`);
      const data = await res.json();
      const found = data.PropertyTable?.Properties?.[0]?.SMILES;
      if (!found) throw new Error(`No SMILES found for "${name}"`);
      setSmiles(found);
      setNameError(null);
      return found;
    } catch (err) {
      setNameError(err.message);
      return null;
    } finally {
      setNameLoading(false);
    }
  }

  // ── Particle emitter ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "scanning" && phase !== "result") return;
    const c = phase === "result" && result
      ? (result.prediction === 1 ? [0, 220, 130] : [220, 60, 90])
      : [0, 160, 255];
    const interval = setInterval(() => {
      const cx = phase === "result" ? window.innerWidth * 0.68 : window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, r = 130 + Math.random() * 50;
        particlesRef.current.push({
          x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
          size: Math.random() * 2 + 0.5, life: 60 + Math.random() * 30,
          r: c[0], g: c[1], b: c[2],
        });
      }
    }, 50);
    return () => clearInterval(interval);
  }, [phase, result]);

  // ── Scan by name handler ──────────────────────────────────────────────────
  async function handleScanByName() {
    if (!nameQuery.trim() || phase === "scanning" || nameLoading) return;
    const found = await fetchSmilesByName(nameQuery);
    if (found) handleScanWithSmiles(found);
  }

  // ── Core scan with explicit smiles string ─────────────────────────────────
  async function handleScanWithSmiles(smilesStr) {
    if (!smilesStr.trim() || phase === "scanning") return;
    setPhase("scanning"); setResult(null); setError(null);
    setMoleculeImg(null); setScanProgress(0); setDisplayedConf(0);
    setHudVisible(false); setMolName(null); setCompletedAt(null);

    setMoleculeImg(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesStr.trim())}/PNG`
    );
    fetchMolName(smilesStr.trim());

    let prog = 0;
    const progInterval = setInterval(() => {
      prog = Math.min(prog + 1, 95);
      setScanProgress(prog);
    }, 28);

    try {
      const [res] = await Promise.all([
        fetch(`${API_URL}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smiles: smilesStr.trim() }),
        }),
        new Promise(r => setTimeout(r, 3200)),
      ]);
      clearInterval(progInterval);
      setScanProgress(100);
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Prediction failed"); }
      const data = await res.json();
      await new Promise(r => setTimeout(r, 400));
      setResult(data);
      setPhase("result");
      setCompletedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

      const target = data.prediction === 1
        ? Math.round(data.probability_bbb_plus * 100)
        : Math.round(data.probability_bbb_minus * 100);
      let cur = 0;
      const ci = setInterval(() => {
        cur += 1; setDisplayedConf(cur);
        if (cur >= target) { clearInterval(ci); setHudVisible(true); }
      }, 16);
    } catch (err) {
      clearInterval(progInterval);
      setError(err.message);
      setPhase("idle");
    }
  }

  // ── Scan handler ───────────────────────────────────────────────────────────
  async function handleScan() {
    handleScanWithSmiles(smiles);
  }

  function handleReset() {
    setPhase("idle"); setResult(null); setError(null);
    setScanProgress(0); setHudVisible(false); setMolName(null); setCompletedAt(null);
    setNameError(null);
  }

  const isPlus = result?.prediction === 1;
  const RC     = result ? (isPlus ? "#00DC82" : "#E03560") : "#00AAFF";
  const RCsoft = result ? (isPlus ? "rgba(0,220,130,0.18)" : "rgba(224,53,96,0.18)") : "rgba(0,170,255,0.12)";

  // ── Confidence label ───────────────────────────────────────────────────────
  function getConfLabel(pct) {
    if (pct >= 85) return "High";
    if (pct >= 65) return "Moderate";
    return "Low";
  }

  // ── Inline style tokens (theme-aware) ─────────────────────────────────────
  const T = {
    bg:          isDark ? "#080C14"        : "#F0F4FA",
    surface:     isDark ? "rgba(12,20,36,0.82)"  : "rgba(255,255,255,0.82)",
    surfaceBold: isDark ? "rgba(16,26,48,0.95)"  : "rgba(248,251,255,0.97)",
    border:      isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
    borderAcc:   isDark ? "rgba(0,180,255,0.18)"  : "rgba(0,100,200,0.18)",
    text:        isDark ? "#E8EEF8"        : "#0D1A2E",
    textMuted:   isDark ? "#6A7A96"        : "#6A7A96",
    textSub:     isDark ? "#9AAABF"        : "#5A6A80",
    inputBg:     isDark ? "rgba(8,14,28,0.7)"  : "rgba(240,246,255,0.9)",
    tagBg:       isDark ? "rgba(0,150,255,0.08)" : "rgba(0,100,200,0.07)",
    tagBorder:   isDark ? "rgba(0,150,255,0.2)"  : "rgba(0,100,200,0.2)",
    tagText:     isDark ? "#5BB8FF"        : "#0060CC",
    logoAcc:     isDark ? "#00AAFF"        : "#005FCC",
  };

  return (
    <>
      {/* ── Global styles ───────────────────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body, #root {
          height: 100%;
          font-family: 'Space Grotesk', 'Inter', sans-serif;
          background: ${T.bg};
          color: ${T.text};
          overflow-x: hidden;
          transition: background 0.3s, color 0.3s;
        }

        .app {
          min-height: 100vh;
          min-height: 100dvh;
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .grid-canvas {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }

        .scanlines {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            ${isDark ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.015)"} 2px,
            ${isDark ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.015)"} 4px
          );
        }

        /* ── TOP BAR ──────────────────────────────────────────────────────── */
        .top-bar {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 28px;
          border-bottom: 1px solid ${T.border};
          background: ${isDark ? "rgba(8,12,22,0.9)" : "rgba(248,251,255,0.92)"};
          backdrop-filter: blur(16px);
          flex-shrink: 0;
        }

        .logo-text {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800;
          font-size: 17px;
          letter-spacing: 3px;
          color: ${T.text};
        }
        .logo-accent { color: ${T.logoAcc}; }

        .logo-sub {
          font-size: 9px;
          letter-spacing: 2px;
          color: ${T.textMuted};
          font-weight: 500;
          text-transform: uppercase;
        }

        .logo-ver {
          margin-left: auto;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          color: ${T.textMuted};
          background: ${T.tagBg};
          border: 1px solid ${T.tagBorder};
          padding: 3px 8px;
          border-radius: 4px;
        }

        .theme-btn {
          background: ${T.tagBg};
          border: 1px solid ${T.tagBorder};
          color: ${T.textSub};
          font-size: 12px;
          cursor: pointer;
          padding: 5px 11px;
          border-radius: 6px;
          transition: all 0.2s;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 500;
          letter-spacing: 0.3px;
        }
        .theme-btn:hover { background: ${T.borderAcc}; color: ${T.text}; }

        /* ── SCENE BASE ───────────────────────────────────────────────────── */
        .scene {
          position: relative;
          z-index: 5;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 24px;
        }

        /* ── IDLE ─────────────────────────────────────────────────────────── */
        .idle-scene {
          flex-direction: column;
          gap: 0;
          align-items: center;
          padding-top: 16px;
          padding-bottom: 24px;
        }

        .idle-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 3.5px;
          color: ${T.logoAcc};
          text-transform: uppercase;
          margin-bottom: 10px;
          opacity: 0.75;
        }

        .idle-title {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800;
          font-size: clamp(32px, 5.5vw, 58px);
          text-align: center;
          line-height: 1.06;
          letter-spacing: -2px;
          color: ${T.text};
          margin-bottom: 10px;
        }
        .idle-title-acc { color: ${T.logoAcc}; }

        .idle-sub {
          font-size: 13px;
          color: ${T.textMuted};
          text-align: center;
          margin-bottom: 24px;
          max-width: 440px;
          line-height: 1.65;
          font-weight: 400;
          padding: 0 8px;
        }

        /* Mode toggle */
        .mode-toggle {
          display: flex;
          align-items: center;
          background: ${T.inputBg};
          border: 1px solid ${T.borderAcc};
          border-radius: 12px;
          padding: 4px;
          margin-bottom: 14px;
          width: 100%;
          max-width: 540px;
          gap: 4px;
        }
        .mode-tab {
          flex: 1;
          padding: 9px 0;
          border: none;
          border-radius: 9px;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: transparent;
          color: ${T.textMuted};
          -webkit-tap-highlight-color: transparent;
        }
        .mode-tab.active {
          background: ${T.logoAcc};
          color: #fff;
          box-shadow: 0 2px 10px ${isDark ? "rgba(0,170,255,0.35)" : "rgba(0,100,200,0.25)"};
        }
        .mode-tab:not(.active):hover {
          color: ${T.text};
          background: ${T.tagBg};
        }

        /* Input block */
        .input-block {
          width: 100%;
          max-width: 540px;
          margin-bottom: 14px;
        }

        .input-label-row {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
        }

        .dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: ${T.logoAcc};
          box-shadow: 0 0 6px ${T.logoAcc};
          flex-shrink: 0;
        }

        .ilabel {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 2px;
          color: ${T.textMuted};
          text-transform: uppercase;
        }

        .smiles-input {
          width: 100%;
          background: ${T.inputBg};
          border: 1px solid ${T.borderAcc};
          border-radius: 10px;
          padding: 14px 18px;
          font-family: 'DM Mono', monospace;
          font-size: 16px; /* 16px prevents iOS auto-zoom on focus */
          color: ${T.text};
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          -webkit-appearance: none;
          appearance: none;
        }
        .smiles-input::placeholder { color: ${T.textMuted}; font-size: 14px; }
        .smiles-input:focus {
          border-color: ${T.logoAcc};
          box-shadow: 0 0 0 3px ${isDark ? "rgba(0,170,255,0.12)" : "rgba(0,100,200,0.1)"};
        }

        /* Resolved SMILES preview */
        .smiles-preview {
          margin-top: 10px;
          padding: 10px 14px;
          background: ${T.tagBg};
          border: 1px solid ${T.tagBorder};
          border-radius: 8px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: ${T.textMuted};
          word-break: break-all;
          line-height: 1.5;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .smiles-preview-label {
          font-size: 9px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: ${T.logoAcc};
          flex-shrink: 0;
          padding-top: 1px;
        }

        /* Main CTA button */
        .scan-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 14px 28px;
          background: ${T.logoAcc};
          color: #fff;
          border: none;
          border-radius: 10px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 15px;
          letter-spacing: 0.2px;
          cursor: pointer;
          transition: all 0.2s ease;
          width: 100%;
          max-width: 540px;
          margin-top: 4px;
          box-shadow: 0 3px 16px ${isDark ? "rgba(0,170,255,0.28)" : "rgba(0,100,200,0.22)"};
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
        }
        .scan-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 24px ${isDark ? "rgba(0,170,255,0.38)" : "rgba(0,100,200,0.32)"};
          filter: brightness(1.08);
        }
        .scan-btn:active:not(:disabled) { transform: translateY(0); filter: brightness(0.96); }
        .scan-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        .scan-btn-secondary {
          background: transparent;
          color: ${T.textSub};
          border: 1px solid ${T.border};
          box-shadow: none;
          font-size: 13px;
          padding: 11px 22px;
          max-width: 300px;
        }
        .scan-btn-secondary:hover:not(:disabled) {
          background: ${T.tagBg};
          color: ${T.text};
          border-color: ${T.borderAcc};
          box-shadow: none;
          filter: none;
        }

        /* Example tags */
        .ex-row {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          justify-content: center;
          margin-top: 16px;
          max-width: 500px;
        }
        .ex-tag {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          padding: 5px 12px;
          border-radius: 20px;
          background: ${T.tagBg};
          border: 1px solid ${T.tagBorder};
          color: ${T.tagText};
          cursor: pointer;
          transition: all 0.18s;
          line-height: 1.4;
        }
        .ex-tag:hover {
          background: ${T.borderAcc};
          border-color: ${T.logoAcc};
          color: ${T.text};
        }

        .error-box {
          margin-top: 14px;
          padding: 11px 16px;
          background: rgba(220,53,96,0.1);
          border: 1px solid rgba(220,53,96,0.3);
          border-radius: 8px;
          font-size: 13px;
          color: #E03560;
          max-width: 520px;
          width: 100%;
        }

        /* ── SCAN SCENE ───────────────────────────────────────────────────── */
        .scan-scene { flex-direction: column; gap: 28px; padding: 24px 16px; }

        .scanner-wrap {
          position: relative;
          width: 220px; height: 220px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid;
          animation: ringPulse 2.8s ease-in-out infinite;
        }
        .r1 { width: 220px; height: 220px; border-color: rgba(0,170,255,0.35); animation-delay: 0s; }
        .r2 { width: 170px; height: 170px; border-color: rgba(0,170,255,0.2);  animation-delay: 0.6s; }
        .r3 { width: 120px; height: 120px; border-color: rgba(0,170,255,0.1);  animation-delay: 1.2s; }

        @keyframes ringPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.04); }
        }

        .ring-c { animation: ringGlow 3s ease-in-out infinite; }
        @keyframes ringGlow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.03); }
        }

        .sweep {
          position: absolute;
          width: 220px; height: 220px;
          border-radius: 50%;
          background: conic-gradient(transparent 270deg, rgba(0,170,255,0.18) 360deg);
          animation: rotate 2.4s linear infinite;
        }
        @keyframes rotate { to { transform: rotate(360deg); } }

        .mol-frame {
          width: 160px; height: 160px;
          border-radius: 50%;
          overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          background: ${isDark ? "rgba(12,22,44,0.85)" : "rgba(240,248,255,0.9)"};
          backdrop-filter: blur(10px);
          border: 1px solid ${T.borderAcc};
        }
        .mol-img {
          width: 140px; height: 140px;
          object-fit: contain;
          ${isDark ? "filter: invert(1) hue-rotate(180deg) brightness(1.2);" : ""}
        }

        .scan-status { text-align: center; }
        .scan-label {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 2.5px;
          color: ${T.textMuted};
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .progress-track {
          width: 320px; max-width: 80vw;
          height: 3px;
          background: ${T.border};
          border-radius: 2px;
          overflow: hidden;
          margin: 0 auto 8px;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #0080FF, #00AAFF);
          border-radius: 2px;
          transition: width 0.1s;
          box-shadow: 0 0 8px rgba(0,170,255,0.5);
        }
        .progress-pct {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: ${T.logoAcc};
        }

        .hud-row {
          display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;
        }
        .hud-cell {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 10px 14px;
          background: ${T.surface};
          border: 1px solid ${T.border};
          border-radius: 8px;
          backdrop-filter: blur(8px);
          min-width: 56px;
        }
        .hk {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 1.5px;
          color: ${T.textMuted};
          text-transform: uppercase;
        }
        .hv-scanning {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: ${T.logoAcc};
          animation: blink 1.2s ease-in-out infinite;
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

        /* ── RESULT SCENE ─────────────────────────────────────────────────── */
        .result-scene {
          align-items: stretch;
          padding: 20px 28px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .result-layout {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 32px;
          width: 100%;
          max-width: 1060px;
          margin: 0 auto;
          align-items: center;
        }

        /* LEFT PANEL */
        .result-left {
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow: hidden;
        }

        /* Hero metric */
        .hero-metric {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .result-conf {
          font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-weight: 700;
          font-size: clamp(60px, 8vw, 96px);
          line-height: 1;
          letter-spacing: -3px;
          transition: color 0.3s;
        }
        .conf-pct {
          font-size: 0.42em;
          font-weight: 600;
          letter-spacing: normal;
          vertical-align: super;
        }

        .result-label {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: clamp(16px, 2vw, 22px);
          letter-spacing: -0.4px;
        }

        .result-subtitle {
          font-size: 12px;
          color: ${T.textMuted};
          font-weight: 400;
          letter-spacing: 0.2px;
        }

        /* Status pills row */
        .status-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .status-row.show { opacity: 1; transform: none; }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 11px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid;
        }
        .pill-dot { width: 5px; height: 5px; border-radius: 50%; animation: pillPulse 2s ease-in-out infinite; }
        @keyframes pillPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        .mol-name-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: ${T.textMuted};
          background: ${T.tagBg};
          border: 1px solid ${T.tagBorder};
          padding: 5px 12px;
          border-radius: 20px;
          max-width: fit-content;
          font-weight: 500;
        }

        /* Details cards wrapper */
        .details-cards-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.5s 0.1s ease, transform 0.5s 0.1s ease;
        }
        .details-cards-container.show { opacity: 1; transform: none; }

        /* Card base */
        .detail-card {
          background: ${T.surface};
          border: 1px solid ${T.border};
          border-radius: 12px;
          padding: 16px 18px;
          backdrop-filter: blur(12px);
          display: flex;
          flex-direction: column;
        }
        .detail-card.full-width { width: 100%; gap: 10px; }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
        }
        .text-center { text-align: center; align-items: center; }
        .highlight-card {
          background: ${isDark ? "rgba(12,20,36,0.95)" : "rgba(255,255,255,0.95)"};
          box-shadow: 0 4px 20px rgba(0,0,0,0.05);
        }

        .details-title {
          font-size: 11px;
          font-family: 'DM Mono', monospace;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: ${T.textMuted};
          margin-bottom: 7px;
        }

        .detail-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 3px 0;
        }

        .stat-val {
          font-size: 22px;
          font-weight: 700;
          margin-top: 3px;
        }

        .dk {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 1.5px;
          color: ${T.textMuted};
          text-transform: uppercase;
          min-width: 60px;
          flex-shrink: 0;
          padding-top: 2px;
        }

        .dv {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: ${T.text};
          word-break: break-all;
          line-height: 1.5;
        }

        /* RIGHT PANEL */
        .result-right {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .mol-ring-wrap {
          position: relative;
          display: flex; align-items: center; justify-content: center;
        }
        
        .mol-ring-wrap.large-mol { width: 320px; height: 320px; }

        .mol-outer-ring {
          position: absolute;
          width: 100%; height: 100%;
          border-radius: 50%;
          border: 1px solid;
          animation: ringGlow 3s ease-in-out infinite;
        }
        .mol-inner-ring {
          position: absolute;
          width: 78%; height: 78%;
          border-radius: 50%;
          border: 1px solid;
          animation: ringGlow 3s ease-in-out infinite;
          animation-delay: 0.8s;
        }

        .mol-glass-frame {
          width: 68%; height: 68%;
          border-radius: 50%;
          overflow: visible;
          display: flex; align-items: center; justify-content: center;
          background: ${isDark
            ? "radial-gradient(circle at 40% 35%, rgba(20,40,80,0.85), rgba(8,14,28,0.92))"
            : "radial-gradient(circle at 40% 35%, rgba(235,246,255,0.95), rgba(215,235,255,0.9))"
          };
          backdrop-filter: blur(16px);
          border: 1px solid ${T.borderAcc};
          box-shadow: ${isDark
            ? "0 0 0 1px rgba(0,0,0,0.3), inset 0 0 30px rgba(0,150,255,0.05)"
            : "0 0 0 1px rgba(255,255,255,0.6), inset 0 0 20px rgba(0,100,200,0.04)"
          };
        }

        /* ── RESPONSIVE ───────────────────────────────────────────────────── */
        @media (max-width: 980px) {
          .result-layout {
            grid-template-columns: 1fr 240px;
            gap: 20px;
          }
          .mol-ring-wrap.large-mol { width: 240px; height: 240px; }
        }

        /* Tablet & large phone — stack vertically */
        @media (max-width: 720px) {
          .result-layout {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .result-right { order: -1; padding: 8px 0 0; }
          .mol-ring-wrap.large-mol { width: 200px; height: 200px; }
          .result-conf { font-size: 72px; }
          .result-scene { padding: 16px; }
          .metrics-grid { grid-template-columns: 1fr 1fr 1fr; }
        }

        /* Small phones */
        @media (max-width: 480px) {
          .top-bar { padding: 12px 16px; gap: 8px; }
          .logo-sub { display: none; }
          .logo-ver { display: none; }
          .scene { padding: 16px; }
          .idle-scene { padding-top: 8px; padding-bottom: 16px; }
          .idle-title { font-size: 30px; letter-spacing: -1px; margin-bottom: 8px; }
          .idle-eyebrow { margin-bottom: 8px; }
          .idle-sub { font-size: 12px; margin-bottom: 18px; }
          .mode-toggle { margin-bottom: 12px; }
          .mode-tab { font-size: 12px; padding: 8px 0; }
          .input-block { margin-bottom: 10px; }
          .ex-row { margin-top: 12px; gap: 6px; }
          .ex-tag { font-size: 10px; padding: 5px 10px; }
          .scan-scene { gap: 20px; padding: 16px; }
          .scanner-wrap { width: 180px; height: 180px; }
          .r1 { width: 180px; height: 180px; }
          .r2 { width: 138px; height: 138px; }
          .r3 { width: 96px; height: 96px; }
          .sweep { width: 180px; height: 180px; }
          .mol-frame { width: 112px; height: 112px; }
          .mol-img { width: 100px; height: 100px; }
          .progress-track { width: 88vw; }
          .hud-row { gap: 5px; }
          .hud-cell { padding: 7px 9px; min-width: 44px; }
          .result-conf { font-size: 58px; letter-spacing: -2px; }
          .result-label { font-size: 16px; }
          .mol-ring-wrap.large-mol { width: 170px; height: 170px; }
          .metrics-grid { grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
          .detail-card { padding: 12px 14px; }
          .stat-val { font-size: 18px; }
          .scan-btn-secondary { max-width: 100%; }
        }
      `}</style>

      <canvas ref={canvasRef} className="grid-canvas" />
      <div className="scanlines" />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="top-bar">
        <span className="logo-text">BBB<span className="logo-accent">P</span></span>
        <span className="logo-sub">BLOOD · BRAIN · BARRIER · PERMEABILITY</span>
        <span className="logo-ver">v2.0</span>
        <button className="theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? "☀ Light" : "◑ Dark"}
        </button>
      </header>

      {/* ── IDLE ──────────────────────────────────────────────────────────── */}
      {phase === "idle" && (
        <main className="scene idle-scene">
          <div className="idle-eyebrow">AI Molecular Analysis</div>
          <div className="idle-title">
            Molecular<br /><span className="idle-title-acc">Scanner</span>
          </div>
          <div className="idle-sub">
            Predict blood-brain barrier permeability from a SMILES string or compound name using ensemble ML models.
          </div>

          {/* Mode toggle */}
          <div className="mode-toggle">
            <button
              className={`mode-tab${inputMode === "smiles" ? " active" : ""}`}
              onClick={() => { setInputMode("smiles"); setNameError(null); }}
            >
              ⬡ SMILES String
            </button>
            <button
              className={`mode-tab${inputMode === "name" ? " active" : ""}`}
              onClick={() => { setInputMode("name"); setError(null); }}
            >
              ⬡ Compound Name
            </button>
          </div>

          {inputMode === "smiles" ? (
            <div className="input-block">
              <div className="input-label-row">
                <span className="dot" />
                <span className="ilabel">SMILES String</span>
              </div>
              <input
                className="smiles-input"
                value={smiles}
                onChange={e => setSmiles(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleScan()}
                placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
                spellCheck={false}
                autoFocus
                aria-label="SMILES input"
              />
            </div>
          ) : (
            <div className="input-block">
              <div className="input-label-row">
                <span className="dot" />
                <span className="ilabel">Compound Name</span>
              </div>
              <input
                className="smiles-input"
                value={nameQuery}
                onChange={e => { setNameQuery(e.target.value); setNameError(null); if (smiles) setSmiles(""); }}
                onKeyDown={e => e.key === "Enter" && handleScanByName()}
                placeholder="e.g. Aspirin, Dopamine, Ibuprofen"
                spellCheck={false}
                autoFocus
                aria-label="Compound name input"
              />
              {smiles && !nameError && (
                <div className="smiles-preview">
                  <span className="smiles-preview-label">SMILES</span>
                  <span>{smiles}</span>
                </div>
              )}
            </div>
          )}

          <button
            className={`scan-btn${
              inputMode === "smiles"
                ? !smiles.trim() ? " scan-btn-off" : ""
                : !nameQuery.trim() || nameLoading ? " scan-btn-off" : ""
            }`}
            onClick={inputMode === "smiles" ? handleScan : handleScanByName}
            disabled={inputMode === "smiles" ? !smiles.trim() : !nameQuery.trim() || nameLoading}
            aria-label="Run prediction"
          >
            {nameLoading ? "⟳ Resolving…" : "⬡ Run Prediction"}
          </button>

          <div className="ex-row">
            {EXAMPLES.map(ex => (
              <span
                key={ex.name}
                className="ex-tag"
                onClick={() => {
                  if (inputMode === "smiles") { setSmiles(ex.smiles); setError(null); }
                  else { setNameQuery(ex.name); setSmiles(""); setNameError(null); }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (inputMode === "smiles") { setSmiles(ex.smiles); setError(null); }
                    else { setNameQuery(ex.name); setSmiles(""); setNameError(null); }
                  }
                }}
              >
                {ex.name}
              </span>
            ))}
          </div>

          {(error || nameError) && (
            <div className="error-box" role="alert">⚠ {error || nameError}</div>
          )}
        </main>
      )}

      {/* ── SCANNING ──────────────────────────────────────────────────────── */}
      {phase === "scanning" && (
        <main className="scene scan-scene">
          <div className="scanner-wrap">
            <div className="ring r1" />
            <div className="ring r2" />
            <div className="ring r3" />
            <div className="sweep" />
            <div className="mol-frame">
              {moleculeImg && (
                <img
                  src={moleculeImg}
                  alt="molecule structure"
                  className="mol-img"
                  onError={e => e.target.style.display = "none"}
                />
              )}
            </div>
          </div>

          <div className="scan-status">
            <div className="scan-label">Analyzing Molecular Structure</div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${scanProgress}%` }} />
            </div>
            <div className="progress-pct">{scanProgress}%</div>
          </div>

          <div className="hud-row">
            {["MW", "logP", "TPSA", "HBD", "HBA", "PSA"].map(k => (
              <div key={k} className="hud-cell">
                <span className="hk">{k}</span>
                <span className="hv-scanning">···</span>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* ── RESULT ──────────────────────────────────────────────────────────── */}
      {phase === "result" && result && (() => {
        const confPct   = displayedConf;
        const confLabel = getConfLabel(
          result.prediction === 1
            ? Math.round(result.probability_bbb_plus * 100)
            : Math.round(result.probability_bbb_minus * 100)
        );

        return (
          <main className="scene result-scene">
            <div className="result-layout">

              {/* LEFT */}
              <div className="result-left">

                {/* 1 · Hero metric — biggest visual focus */}
                <div className="hero-metric">
                  <div className="result-conf" style={{ color: RC }}>
                    {confPct}<span className="conf-pct">%</span>
                  </div>
                  <div className="result-label" style={{ color: RC }}>
                    {isPlus ? "BBB Permeable" : "BBB Non-Permeable"}
                  </div>
                  <div className="result-subtitle">
                    AI-powered molecular permeability analysis
                  </div>
                </div>

                {/* 2 · Status pills */}
                <div className={`status-row${hudVisible ? " show" : ""}`}>
                  <span
                    className="status-pill"
                    style={{
                      background: RCsoft,
                      borderColor: RC + "50",
                      color: RC,
                    }}
                  >
                    <span className="pill-dot" style={{ background: RC }} />
                    Confidence: {confLabel}
                  </span>
                  <span
                    className="status-pill"
                    style={{
                      background: T.tagBg,
                      borderColor: T.tagBorder,
                      color: T.tagText,
                    }}
                  >
                    <span className="pill-dot" style={{ background: T.logoAcc }} />
                    Model Active
                  </span>
                  <span
                    className="status-pill"
                    style={{
                      background: T.tagBg,
                      borderColor: T.tagBorder,
                      color: T.textMuted,
                    }}
                  >
                    Completed
                    {completedAt && ` · ${completedAt}`}
                  </span>
                </div>

                {/* 3 · Molecule Details Cards */}
                <div className={`details-cards-container${hudVisible ? " show" : ""}`}>
                  
                  {/* Molecule Info Card */}
                  <div className="detail-card full-width">
                    <div className="details-title">Molecule Info</div>
                    {molName && (
                      <div className="detail-row">
                        <span className="dk">Name</span>
                        <div className="mol-name-badge">
                          <span style={{ color: T.logoAcc }}>⬡</span>
                          {molName}
                        </div>
                      </div>
                    )}
                    <div className="detail-row">
                      <span className="dk">SMILES</span>
                      <code className="dv">{result.smiles}</code>
                    </div>
                  </div>

                  {/* 3-Column Metrics Grid */}
                  <div className="metrics-grid">
                    <div className="detail-card text-center">
                      <div className="details-title">P(BBB+)</div>
                      <span className="dv stat-val" style={{ color: "#00DC82" }}>
                        {(result.probability_bbb_plus * 100).toFixed(1)}%
                      </span>
                    </div>
                    
                    <div className="detail-card text-center">
                      <div className="details-title">P(BBB−)</div>
                      <span className="dv stat-val" style={{ color: "#E03560" }}>
                        {(result.probability_bbb_minus * 100).toFixed(1)}%
                      </span>
                    </div>
                    
                    <div className="detail-card text-center highlight-card" style={{ borderColor: RC + "40" }}>
                      <div className="details-title">Result</div>
                      <span className="dv stat-val" style={{ color: RC }}>
                        {result.label}
                      </span>
                    </div>
                  </div>

                </div>

                {/* 4 · Action button */}
                <button className="scan-btn scan-btn-secondary" onClick={handleReset}>
                  ← Analyze Another Molecule
                </button>
              </div>

              {/* RIGHT — molecule visualization */}
              <div className="result-right">
                <div className="mol-ring-wrap large-mol">
                  <div
                    className="mol-outer-ring"
                    style={{ borderColor: RC + "40", boxShadow: `0 0 40px ${RCsoft}` }}
                  />
                  <div
                    className="mol-inner-ring"
                    style={{ borderColor: RC + "25" }}
                  />
                  <div
                    className="mol-glass-frame"
                    style={{ boxShadow: `0 0 50px ${RCsoft}, 0 0 0 1px ${RC}20` }}
                  >
                    {moleculeImg && (
                      <img
                        src={moleculeImg}
                        alt="molecule structure"
                        className="mol-img"
                        style={{
                          width: "110%",
                          height: "110%",
                          objectFit: "contain",
                          padding: "12px",
                          filter: isDark
                            ? `invert(1) hue-rotate(180deg) brightness(2.8) contrast(1.15) drop-shadow(0 0 8px ${RC}60)`
                            : `drop-shadow(0 0 10px ${RC}50)`,
                        }}
                        onError={e => e.target.style.display = "none"}
                      />
                    )}
                  </div>
                </div>
              </div>

            </div>
          </main>
        );
      })()}
    </>
  );
}
