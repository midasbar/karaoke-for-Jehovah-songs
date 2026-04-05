import { useState, useEffect, useRef, useCallback } from "react";
import { loadSong, loadSyncFromFile, buildTimeline, saveSyncData, loadSyncData, clearSyncData, exportSyncData, importSyncData } from "./songLoader";
import TapSync from "./TapSync";

const SONG_ID = "cantico-160";

// ─── TIP CONFIG ──────────────────────────────────────────────────────────────
const TIPS = {
  breath: {
    icon: "🌬",
    label: "Respire aqui",
    desc: "Inspire fundo antes desta frase",
    color: "#4ECDC4",
    bg: "rgba(78,205,196,0.12)",
    border: "rgba(78,205,196,0.4)",
  },
  "volume-up": {
    icon: "📢",
    label: "Aumente o volume",
    desc: "Projete mais a voz — nota mais forte",
    color: "#FF6B6B",
    bg: "rgba(255,107,107,0.12)",
    border: "rgba(255,107,107,0.4)",
  },
  "volume-down": {
    icon: "🔉",
    label: "Suavize o volume",
    desc: "Diminua a intensidade aqui",
    color: "#A29BFE",
    bg: "rgba(162,155,254,0.12)",
    border: "rgba(162,155,254,0.4)",
  },
  smooth: {
    icon: "〰",
    label: "Ligue as sílabas",
    desc: "Deslize suavemente — não corte o som",
    color: "#FD79A8",
    bg: "rgba(253,121,168,0.12)",
    border: "rgba(253,121,168,0.4)",
  },
  hold: {
    icon: "⬛",
    label: "Sustente a nota",
    desc: "Mantenha o som até o fim da nota",
    color: "#FDCB6E",
    bg: "rgba(253,203,110,0.12)",
    border: "rgba(253,203,110,0.4)",
  },
};

// ─── PITCH VISUALIZER ────────────────────────────────────────────────────────
function PitchBar({ pitch, active }) {
  const heights = [0, 16, 28, 40, 52, 64];
  const h = heights[pitch] || 0;
  const colors = ["transparent", "#4A90D9", "#50C878", "#F9D71C", "#FF9F43", "#FF6B6B"];
  return (
    <div
      style={{
        width: 6,
        height: h,
        borderRadius: 3,
        background: pitch > 0 ? colors[pitch] : "transparent",
        transition: "height 0.2s ease, opacity 0.2s",
        opacity: active ? 1 : 0.35,
        alignSelf: "flex-end",
      }}
    />
  );
}

// ─── WAVEFORM VISUALIZER ─────────────────────────────────────────────────────
function WaveVisualizer({ analyser, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!analyser || !isPlaying) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const bufLen = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(232,160,32,0.8)";
      ctx.beginPath();
      const sliceW = canvas.width / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = dataArr[i] / 128;
        const y = (v * canvas.height) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={40}
      style={{ width: "100%", height: 40, opacity: isPlaying ? 1 : 0.2, transition: "opacity 0.3s" }}
    />
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function KaraokeApp() {
  const [song, setSong] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [totalMs, setTotalMs] = useState(0);
  const [syncData, setSyncData] = useState(null);
  const [isSynced, setIsSynced] = useState(false);
  const [showTapSync, setShowTapSync] = useState(false);
  const [audioTrack, setAudioTrack] = useState("sung"); // "sung" | "melody"
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [offset, setOffset] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [activeTip, setActiveTip] = useState(null);
  const [currentSylIdx, setCurrentSylIdx] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [loading, setLoading] = useState(true);

  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const intervalRef = useRef(null);
  const lyricsRef = useRef(null);

  // Load song data + sync + auto-load audio
  useEffect(() => {
    loadSong(SONG_ID).then(async (data) => {
      setSong(data);
      // Try localStorage first, then sync.json file
      let sync = loadSyncData(SONG_ID);
      if (!sync) {
        sync = await loadSyncFromFile(SONG_ID);
      }
      setSyncData(sync);
      setIsSynced(!!sync);
      const { flat, totalMs: tMs } = buildTimeline(data, sync);
      setTimeline(flat);
      setTotalMs(tMs);
      // Auto-load audio
      const trackKey = "sung";
      const fileName = data.audioFiles[trackKey];
      if (fileName) {
        setAudioUrl(data.audioUrl(fileName));
        setHasAudio(true);
      }
      setLoading(false);
    });
  }, []);

  // Rebuild timeline when sync data changes
  const rebuildWithSync = useCallback((sync) => {
    if (!song) return;
    setSyncData(sync);
    setIsSynced(!!sync);
    const { flat, totalMs: tMs } = buildTimeline(song, sync);
    setTimeline(flat);
    setTotalMs(tMs);
  }, [song]);

  // Switch audio track (sung/melody)
  const switchTrack = useCallback((track) => {
    if (!song) return;
    setAudioTrack(track);
    const fileName = song.audioFiles[track];
    if (fileName) {
      // Reset audio context so it reconnects
      audioCtxRef.current = null;
      analyserRef.current = null;
      setAudioUrl(song.audioUrl(fileName));
      setHasAudio(true);
      setCurrentMs(0);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.pause();
      }
    }
  }, [song]);

  // Tap sync complete handler
  const handleSyncComplete = useCallback((taps) => {
    const saved = saveSyncData(SONG_ID, taps);
    rebuildWithSync(saved);
    setShowTapSync(false);
  }, [rebuildWithSync]);

  // Setup audio context + analyser
  const setupAudioContext = useCallback((audioEl) => {
    if (audioCtxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setAudioUrl(url);
    setHasAudio(true);
    setCurrentMs(0);
    setIsPlaying(false);
  }, []);

  // Update current syllable based on time
  useEffect(() => {
    const adjusted = currentMs - offset;
    const idx = timeline.findIndex(
      (s) => adjusted >= s.startMs && adjusted < s.endMs
    );
    if (idx !== currentSylIdx) {
      setCurrentSylIdx(idx);
      // Find upcoming tip in next 1.5s
      const upcoming = timeline.slice(idx, idx + 6).find(
        (s) => s.tip && s.startMs - adjusted < 1500 && s.startMs - adjusted > 0
      );
      // Or current tip
      const cur = idx >= 0 ? timeline[idx] : null;
      setActiveTip(upcoming?.tip || cur?.tip || null);
    }
  }, [currentMs, offset, currentSylIdx]);

  // Scroll active line into view
  useEffect(() => {
    if (currentSylIdx < 0) return;
    const lineId = timeline[currentSylIdx]?.lineId;
    if (lineId && lyricsRef.current) {
      const el = lyricsRef.current.querySelector(`[data-line="${lineId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentSylIdx]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.src = audioUrl;
    audio.playbackRate = speed;

    const onMeta = () => setAudioDuration(audio.duration * 1000);
    const onTime = () => setCurrentMs(audio.currentTime * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); setCurrentMs(0); };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl, speed]);

  // Demo mode (no audio) - simulate timing
  useEffect(() => {
    if (hasAudio) return;
    if (!isPlaying) return;
    const step = 100;
    intervalRef.current = setInterval(() => {
      setCurrentMs((prev) => {
        if (prev >= totalMs) { setIsPlaying(false); return 0; }
        return prev + step * speed;
      });
    }, step);
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, hasAudio, speed]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (hasAudio && audio) {
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
      if (!audioCtxRef.current) setupAudioContext(audio);
      if (isPlaying) audio.pause();
      else audio.play().catch(() => {});
    } else {
      setIsPlaying((p) => !p);
    }
  }, [hasAudio, isPlaying, setupAudioContext]);

  const restart = useCallback(() => {
    setCurrentMs(0);
    setIsPlaying(false);
    if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.pause(); }
  }, []);

  const handleSeek = useCallback((e) => {
    const pct = parseFloat(e.target.value) / 100;
    const ms = pct * (hasAudio ? audioDuration : totalMs);
    setCurrentMs(ms);
    if (audioRef.current && hasAudio) audioRef.current.currentTime = ms / 1000;
  }, [hasAudio, audioDuration]);

  const progress = hasAudio
    ? (currentMs / audioDuration) * 100
    : (currentMs / totalMs) * 100;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading || !song) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0D0D0D", color: "#F0EDE6",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>♩</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>Carregando...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0D0D0D",
      color: "#F0EDE6",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
      userSelect: "none",
    }}>
      {/* TapSync overlay */}
      {showTapSync && (
        <TapSync
          song={song}
          audioUrl={audioUrl}
          onComplete={handleSyncComplete}
          onCancel={() => setShowTapSync(false)}
        />
      )}

      {/* Background grain */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
      }} />

      {/* Header */}
      <header style={{
        padding: "20px 24px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "relative", zIndex: 1,
        background: "rgba(13,13,13,0.95)",
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 12, letterSpacing: "0.14em", color: "#E8A020", textTransform: "uppercase", fontFamily: "monospace" }}>
                {song?.number}
              </span>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>{song?.reference}</span>
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 400, fontStyle: "italic", letterSpacing: "-0.02em", color: "#F0EDE6" }}>
              {song?.title}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.06em",
            }}>{song?.key}</span>
            {isSynced && (
              <span style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 20,
                border: "1px solid rgba(78,205,196,0.4)", color: "#4ECDC4",
                letterSpacing: "0.06em", fontFamily: "monospace",
                background: "rgba(78,205,196,0.08)",
              }}>✓ Sincronizado</span>
            )}
            <button
              onClick={() => setShowSettings(s => !s)}
              style={{
                background: showSettings ? "rgba(232,160,32,0.2)" : "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#F0EDE6", borderRadius: 8, padding: "5px 10px",
                cursor: "pointer", fontSize: 16,
              }}>⚙</button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div style={{
            marginTop: 14, padding: "14px 16px",
            background: "rgba(255,255,255,0.04)", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px",
          }}>
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>VELOCIDADE</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input type="range" min="0.5" max="1.5" step="0.1" value={speed}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setSpeed(v);
                    if (audioRef.current) audioRef.current.playbackRate = v;
                  }}
                  style={{ flex: 1, accentColor: "#E8A020" }} />
                <span style={{ fontSize: 13, color: "#E8A020", minWidth: 30, textAlign: "right", fontFamily: "monospace" }}>{speed.toFixed(1)}x</span>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>AJUSTE DE SINCRONIA (ms)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input type="range" min="-3000" max="3000" step="100" value={offset}
                  onChange={e => setOffset(parseInt(e.target.value))}
                  style={{ flex: 1, accentColor: "#E8A020" }} />
                <span style={{ fontSize: 13, color: "#E8A020", minWidth: 40, textAlign: "right", fontFamily: "monospace" }}>{offset > 0 ? "+" : ""}{offset}</span>
              </div>
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>FAIXA DE ÁUDIO</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => switchTrack("sung")} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  background: audioTrack === "sung" ? "rgba(232,160,32,0.2)" : "transparent",
                  border: `1px solid ${audioTrack === "sung" ? "#E8A020" : "rgba(255,255,255,0.12)"}`,
                  color: audioTrack === "sung" ? "#E8A020" : "rgba(255,255,255,0.5)",
                }}>🎤 Cantada</button>
                <button onClick={() => switchTrack("melody")} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  background: audioTrack === "melody" ? "rgba(232,160,32,0.2)" : "transparent",
                  border: `1px solid ${audioTrack === "melody" ? "#E8A020" : "rgba(255,255,255,0.12)"}`,
                  color: audioTrack === "melody" ? "#E8A020" : "rgba(255,255,255,0.5)",
                }}>🎹 Melodia</button>
                <label style={{
                  display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 13,
                }}>
                  📂 Outro
                  <input type="file" accept="audio/*" onChange={handleFileUpload} style={{ display: "none" }} />
                </label>
              </div>
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>SINCRONIZAÇÃO</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => { setShowTapSync(true); setShowSettings(false); }} disabled={!hasAudio} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 13, cursor: hasAudio ? "pointer" : "not-allowed",
                  background: "rgba(78,205,196,0.1)",
                  border: "1px solid rgba(78,205,196,0.4)", color: hasAudio ? "#4ECDC4" : "rgba(255,255,255,0.2)",
                }}>🎯 Tap Sync</button>
                {isSynced && (
                  <>
                    <button onClick={() => exportSyncData(SONG_ID)} style={{
                      padding: "7px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)",
                    }}>📤 Exportar</button>
                    <button onClick={() => { clearSyncData(SONG_ID); rebuildWithSync(null); }} style={{
                      padding: "7px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: "transparent",
                      border: "1px solid rgba(255,107,107,0.3)", color: "rgba(255,107,107,0.6)",
                    }}>🗑 Limpar Sync</button>
                  </>
                )}
                <label style={{
                  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", fontSize: 13,
                }}>
                  📥 Importar
                  <input type="file" accept=".json" onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    try {
                      const data = await importSyncData(SONG_ID, file);
                      rebuildWithSync(data);
                    } catch (err) {
                      console.error("Import failed:", err);
                    }
                  }} style={{ display: "none" }} />
                </label>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Hidden audio element */}
      <audio ref={audioRef} style={{ display: "none" }} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 0, position: "relative", zIndex: 1 }}>

        {/* Tip banner */}
        <div style={{
          minHeight: 52, padding: "0 24px",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.3s ease",
          background: activeTip ? TIPS[activeTip]?.bg : "transparent",
          borderBottom: `1px solid ${activeTip ? TIPS[activeTip]?.border : "transparent"}`,
        }}>
          {activeTip && TIPS[activeTip] ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "center" }}>
              <span style={{ fontSize: 22 }}>{TIPS[activeTip].icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: TIPS[activeTip].color, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "monospace" }}>
                  {TIPS[activeTip].label}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{TIPS[activeTip].desc}</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.08em" }}>
              {isPlaying ? "♩ cantando..." : "pressione ▶ para iniciar"}
            </div>
          )}
        </div>

        {/* Lyrics area */}
        <div
          ref={lyricsRef}
          style={{
            flex: 1, overflowY: "auto", padding: "24px 20px 32px",
            scrollBehavior: "smooth",
          }}
        >
          {song?.sections.map((section) => (
            <div key={section.id} style={{ marginBottom: 36 }}>
              <div style={{
                fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
                color: section.color, marginBottom: 16, fontFamily: "monospace",
                opacity: 0.8, paddingLeft: 4,
                borderLeft: `2px solid ${section.color}`, paddingLeft: 8,
              }}>
                {section.label}
              </div>
              {section.lines.map((line) => {
                const isActiveLine = timeline[currentSylIdx]?.lineId === line.id;
                return (
                  <div
                    key={line.id}
                    data-line={line.id}
                    style={{
                      display: "flex", flexWrap: "wrap", alignItems: "flex-end",
                      gap: "0px 2px", marginBottom: 20,
                      padding: "10px 12px", borderRadius: 10,
                      background: isActiveLine ? "rgba(255,255,255,0.04)" : "transparent",
                      border: `1px solid ${isActiveLine ? "rgba(255,255,255,0.1)" : "transparent"}`,
                      transition: "all 0.3s ease",
                    }}
                  >
                    {/* Pitch bar row above */}
                    <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", marginBottom: 6, height: 68 }}>
                      {line.syllables.map((syl, i) => {
                        const sylIdx = timeline.findIndex(
                          (s) => s.lineId === line.id && s.startMs === timeline.find(t => t.lineId === line.id)?.startMs + line.syllables.slice(0, i).reduce((a, s) => a + s.dur, 0)
                        );
                        const isActive = sylIdx === currentSylIdx;
                        if (syl.text === " " || syl.text === "-") return <div key={i} style={{ width: syl.text === " " ? 8 : 3 }} />;
                        return <PitchBar key={i} pitch={syl.pitch} active={isActive} />;
                      })}
                    </div>

                    {/* Syllables row */}
                    {line.syllables.map((syl, i) => {
                      // Find global index for this syllable
                      const lineStart = timeline.find(t => t.lineId === line.id)?.startMs ?? 0;
                      const sylOffset = line.syllables.slice(0, i).reduce((a, s) => a + s.dur, 0);
                      const sylGlobalStart = lineStart + sylOffset;
                      const sylIdx = timeline.findIndex(t => t.lineId === line.id && Math.abs(t.startMs - sylGlobalStart) < 5);
                      const isActive = sylIdx === currentSylIdx;
                      const isPast = sylIdx < currentSylIdx && currentSylIdx >= 0;

                      if (syl.text === "-") {
                        return <span key={i} style={{ fontSize: 22, color: "rgba(255,255,255,0.2)", lineHeight: 1 }}>-</span>;
                      }
                      if (syl.text === " ") {
                        return (
                          <span key={i} style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", margin: "0 4px" }}>
                            {syl.tip === "breath" && (
                              <span style={{ fontSize: 10, color: "#4ECDC4", display: "block", lineHeight: 1 }}>🌬</span>
                            )}
                          </span>
                        );
                      }

                      return (
                        <span
                          key={i}
                          style={{
                            position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center",
                          }}
                        >
                          {/* Tip indicator above syllable */}
                          {syl.tip && syl.tip !== "breath" && (
                            <span style={{
                              fontSize: 10, marginBottom: 2,
                              color: TIPS[syl.tip]?.color || "transparent",
                              opacity: isActive ? 1 : 0.4,
                              transition: "opacity 0.2s",
                            }}>
                              {TIPS[syl.tip]?.icon}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 24, lineHeight: 1.2, fontStyle: "italic",
                              fontWeight: isActive ? 600 : 400,
                              color: isActive
                                ? section.color
                                : isPast
                                ? "rgba(255,255,255,0.25)"
                                : "rgba(255,255,255,0.75)",
                              textShadow: isActive ? `0 0 20px ${section.color}80` : "none",
                              transition: "all 0.15s ease",
                              transform: isActive ? "scale(1.08) translateY(-2px)" : "scale(1)",
                              transformOrigin: "bottom center",
                            }}
                          >
                            {syl.text}
                          </span>
                          {/* Underline progress */}
                          {isActive && (
                            <span style={{
                              display: "block", height: 2, background: section.color,
                              borderRadius: 2, marginTop: 2,
                              width: "100%",
                              animation: `grow ${syl.dur}ms linear forwards`,
                            }} />
                          )}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Player controls */}
      <div style={{
        padding: "16px 24px 20px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(13,13,13,0.97)",
        backdropFilter: "blur(16px)",
        position: "sticky", bottom: 0, zIndex: 10,
      }}>
        {/* Waveform */}
        {hasAudio && (
          <div style={{ marginBottom: 10 }}>
            <WaveVisualizer analyser={analyserRef.current} isPlaying={isPlaying} />
          </div>
        )}

        {/* Progress bar */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="range" min="0" max="100" step="0.1"
            value={Math.min(progress, 100)}
            onChange={handleSeek}
            style={{
              width: "100%", accentColor: "#E8A020", cursor: "pointer",
              appearance: "none", height: 3, background: `linear-gradient(to right, #E8A020 ${progress}%, rgba(255,255,255,0.15) ${progress}%)`,
              borderRadius: 2, outline: "none", border: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
              {Math.floor(currentMs / 60000)}:{String(Math.floor((currentMs % 60000) / 1000)).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
              {Math.floor((hasAudio ? audioDuration : totalMs) / 60000)}:{String(Math.floor(((hasAudio ? audioDuration : totalMs) % 60000) / 1000)).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <button onClick={restart} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.6)", borderRadius: "50%", width: 40, height: 40,
            cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
          }}>↺</button>
          <button onClick={togglePlay} style={{
            background: "#E8A020", border: "none",
            color: "#000", borderRadius: "50%", width: 56, height: 56,
            cursor: "pointer", fontSize: 22,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 24px rgba(232,160,32,0.4)",
            transition: "transform 0.1s, box-shadow 0.2s",
          }}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={() => setShowSettings(s => !s)} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.6)", borderRadius: "50%", width: 40, height: 40,
            cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {hasAudio ? "🎵" : "📂"}
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
          {Object.entries(TIPS).map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{v.icon}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.04em" }}>{v.label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes grow {
          from { transform: scaleX(0); transform-origin: left; }
          to { transform: scaleX(1); transform-origin: left; }
        }
        input[type=range]::-webkit-slider-thumb {
          appearance: none; width: 14px; height: 14px;
          background: #E8A020; border-radius: 50%; cursor: pointer;
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
      `}</style>
    </div>
  );
}
