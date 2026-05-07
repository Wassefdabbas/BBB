import { useState, useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://bbb-pndk.onrender.com";

const EXAMPLES = [
  { name: "Aspirin",   smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { name: "Caffeine",  smiles: "Cn1c(=O)c2c(ncn2C)n(c1=O)C" },
  { name: "Ibuprofen", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O" },
  { name: "Dopamine",  smiles: "NCCc1ccc(O)c(O)c1" },
  { name: "Morphine",  smiles: "OC1=CC2=C(C=C1)C1CC3N(CC1CC3O2)C" },
];

export default function App() {
  const [smiles, setSmiles]               = useState("");
  const [phase, setPhase]                 = useState("idle");
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);
  const [scanProgress, setScanProgress]   = useState(0);
  const [moleculeImg, setMoleculeImg]     = useState(null);
  const [displayedConf, setDisplayedConf] = useState(0);
  const [hudVisible, setHudVisible]       = useState(false);
  const [molName, setMolName] = useState(null);


  const canvasRef    = useRef(null);
  const animRef      = useRef(null);
  const particlesRef = useRef([]);

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
      gridOffset = (gridOffset + 0.2) % 80;

      ctx.strokeStyle = "rgba(0,180,255,0.05)";
      ctx.lineWidth   = 1;
      for (let x = (gridOffset % 80) - 80; x < canvas.width + 80; x += 80) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height + 80; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      for (const p of particlesRef.current) {
        p.x += p.vx; p.y += p.vy; p.life -= 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${(p.life / 100).toFixed(2)})`;
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(animRef.current); };
  }, []);

// name of smile
  async function fetchMolName(smiles) {
  try {
    const res = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/synonyms/JSON`
    );
    if (!res.ok) return;
    const data = await res.json();
    const synonyms = data.InformationList?.Information?.[0]?.Synonym;
    if (synonyms?.length) setMolName(synonyms[0]);
  } catch { /* not found, stay null */ }
}


  // ── Particle emitter ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "scanning" && phase !== "result") return;
    const c = phase === "result" && result
      ? (result.prediction === 1 ? [0,255,136] : [255,51,102])
      : [0,180,255];
    const interval = setInterval(() => {
    const cx = phase === "result" ? window.innerWidth * 0.70 : window.innerWidth / 2;
    const cy = window.innerHeight / 2;
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2, r = 140 + Math.random() * 60;
        particlesRef.current.push({
          x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 2.5, vy: (Math.random() - 0.5) * 2.5,
          size: Math.random() * 2.5 + 0.5, life: 70 + Math.random() * 30,
          r: c[0], g: c[1], b: c[2],
        });
      }
    }, 40);
    return () => clearInterval(interval);
  }, [phase, result]);

  // ── Scan handler ───────────────────────────────────────────────────────────
  async function handleScan() {
    if (!smiles.trim() || phase === "scanning") return;
    setPhase("scanning"); setResult(null); setError(null);
    setMoleculeImg(null); setScanProgress(0); setDisplayedConf(0); setHudVisible(false);

    // setMoleculeImg(`${API_URL}/depict?smiles=${encodeURIComponent(smiles.trim())}`);
    setMoleculeImg(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles.trim())}/PNG`);
    fetchMolName(smiles.trim());

    let prog = 0;
    const progInterval = setInterval(() => { prog = Math.min(prog + 1, 95); setScanProgress(prog); }, 28);

    try {
      const [res] = await Promise.all([
        fetch(`${API_URL}/predict`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smiles: smiles.trim() }),
        }),
        new Promise(r => setTimeout(r, 3200)),
      ]);
      clearInterval(progInterval); setScanProgress(100);
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Prediction failed"); }
      const data = await res.json();
      await new Promise(r => setTimeout(r, 400));
      setResult(data); setPhase("result");

      const target = data.prediction === 1
        ? Math.round(data.probability_bbb_plus  * 100)
        : Math.round(data.probability_bbb_minus * 100);      let cur = 0;
      const ci = setInterval(() => {
        cur += 1; setDisplayedConf(cur);
        if (cur >= target) { clearInterval(ci); setHudVisible(true); }
      }, 18);
    } catch (err) {
      clearInterval(progInterval); setError(err.message); setPhase("idle");
    }
  }

  function handleReset() { setPhase("idle"); setResult(null); setError(null); setScanProgress(0); setHudVisible(false);setMolName(null); }

  const isPlus      = result?.prediction === 1;
  const RC          = result ? (isPlus ? "#00FF88" : "#FF3366") : "#00AAFF";
  const RG          = result ? (isPlus ? "rgba(0,255,136,0.25)" : "rgba(255,51,102,0.25)") : "rgba(0,170,255,0.15)";

  return (
    <div className="app">
      <canvas ref={canvasRef} className="grid-canvas" />
      <div className="scanlines" />

      <header className="top-bar">
        <span className="logo-text">BBB<span className="logo-accent">P</span></span>
        <span className="logo-sub">BLOOD · BRAIN · BARRIER · PERMEABILITY</span>
        <span className="logo-ver">v2.0</span>
      </header>

      {/* IDLE */}
      {phase === "idle" && (
        <main className="scene idle-scene">
          <div className="idle-title">MOLECULAR<br />SCANNER</div>
          <div className="idle-sub">Predict blood-brain barrier permeability from SMILES</div>

          <div className="input-block">
            <div className="input-label-row"><span className="dot" /><span className="ilabel">SMILES STRING</span></div>
            <input
              className="smiles-input"
              value={smiles}
              onChange={e => setSmiles(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleScan()}
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
              spellCheck={false} autoFocus
            />
            <div className="input-underline" />
          </div>

          <button className={`scan-btn ${!smiles.trim() ? "scan-btn-off" : ""}`} onClick={handleScan} disabled={!smiles.trim()}>
            [ INITIATE SCAN ]
          </button>

          <div className="ex-row">
            {EXAMPLES.map(ex => (
              <span key={ex.name} className="ex-tag" onClick={() => { setSmiles(ex.smiles); setError(null); }}>{ex.name}</span>
            ))}
          </div>
          {error && <div className="error-box">⚠ {error}</div>}
        </main>
      )}

      {/* SCANNING */}
      {phase === "scanning" && (
        <main className="scene scan-scene">
          <div className="scanner-wrap">
            <div className="ring r1" /><div className="ring r2" /><div className="ring r3" />
            <div className="sweep" />
            <div className="mol-frame">
              {moleculeImg && <img src={moleculeImg} alt="molecule" className="mol-img" onError={e => e.target.style.display="none"} />}
            </div>
          </div>
          <div className="scan-status">
            <div className="scan-label">ANALYZING MOLECULAR STRUCTURE</div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${scanProgress}%` }} /></div>
            <div className="progress-pct">{scanProgress}%</div>
          </div>
          <div className="hud-row">
            {["MW","logP","TPSA","HBD","HBA","PSA"].map(k => (
              <div key={k} className="hud-cell"><span className="hk">{k}</span><span className="hv-scanning">···</span></div>
            ))}
          </div>
        </main>
      )}

      {/* RESULT */}
{/* RESULT */}
{phase === "result" && result && (
  <main className="scene result-scene">
    <div className="result-layout">

      {/* LEFT — info */}
      <div className="result-left">
        <div className="result-badge" style={{ color: RC, borderColor: RC,     textShadow: `0 0 6px ${RC}, 0 0 12px ${RG}, 0 0 24px ${RG}` }}>
          {result.label}
        </div>

        <div className="result-conf" style={{ color: RC }}>
          {displayedConf}<span className="conf-pct">%</span>
        </div>

        <div className="result-desc">
          {isPlus ? "MOLECULE CAN CROSS THE BLOOD-BRAIN BARRIER" : "MOLECULE CANNOT CROSS THE BLOOD-BRAIN BARRIER"}
        </div>

        {molName && <div className="mol-name">{molName}</div>}

        <div className={`hud-data ${hudVisible ? "hud-show" : ""}`}>
          <div className="hd-item"><span className="hdk">SMILES</span><code className="hdv">{result.smiles}</code></div>
          <div className="hd-item"><span className="hdk">P(BBB+)</span><span className="hdv" style={{color:"#00FF88"}}>{(result.probability_bbb_plus*100).toFixed(1)}%</span></div>
          <div className="hd-item"><span className="hdk">P(BBB−)</span><span className="hdv" style={{color:"#FF3366"}}>{(result.probability_bbb_minus*100).toFixed(1)}%</span></div>
        </div>

        <button className="scan-btn" onClick={handleReset}>[ NEW SCAN ]</button>
      </div>

      {/* RIGHT — molecule image */}
      <div className="result-right">
        <div className="scanner-wrap">
          <div className="ring r1 ring-c" style={{ borderColor: RC, boxShadow: `0 0 40px ${RG}` }} />
          <div className="ring r2 ring-c" style={{ borderColor: RC + "60" }} />
          <div className="mol-frame">
            {moleculeImg && (
              <img src={moleculeImg} alt="molecule" className="mol-img"
                style={{ filter: `drop-shadow(0 0 18px ${RC}90)` }}
                onError={e => e.target.style.display="none"} />
            )}
          </div>
        </div>
      </div>

    </div>
  </main>
)}
    </div>
  );
}
