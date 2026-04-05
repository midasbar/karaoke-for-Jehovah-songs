import { useState, useRef, useCallback, useEffect } from "react";

export default function TapSync({ song, audioUrl, onComplete, onCancel }) {
  const [taps, setTaps] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef(null);
  const animRef = useRef(null);

  // Flatten all syllables for indexing
  const allSyllables = [];
  song.sections.forEach((section) => {
    section.lines.forEach((line) => {
      line.syllables.forEach((syl) => {
        allSyllables.push({ ...syl, sectionId: section.id, lineId: line.id, sectionColor: section.color });
      });
    });
  });

  const totalSyllables = allSyllables.length;
  const currentIdx = taps.length;
  const isDone = currentIdx >= totalSyllables;

  // High-precision time tracking via requestAnimationFrame
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const tick = () => {
      if (audio && !audio.paused) {
        setCurrentMs(audio.currentTime * 1000);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = audioUrl;

    const onMeta = () => setAudioDuration(audio.duration * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play().catch(() => {});
  }, [isPlaying]);

  const handleTap = useCallback(() => {
    if (isDone || !isPlaying) return;
    const audio = audioRef.current;
    if (!audio) return;
    const ms = Math.round(audio.currentTime * 1000);
    setTaps((prev) => [...prev, { idx: prev.length, startMs: ms }]);
  }, [isDone, isPlaying]);

  const handleUndo = useCallback(() => {
    setTaps((prev) => prev.slice(0, -1));
  }, []);

  const handleRestart = useCallback(() => {
    setTaps([]);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.pause();
    }
    setCurrentMs(0);
  }, []);

  const handleSave = useCallback(() => {
    onComplete(taps);
  }, [taps, onComplete]);

  // Keyboard: Space=tap, Backspace=undo
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!isPlaying) {
          togglePlay();
        } else {
          handleTap();
        }
      }
      if (e.code === "Backspace" || e.code === "KeyZ") {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, handleTap, handleUndo, togglePlay]);

  // Find which section/line context to show
  const currentSyl = allSyllables[currentIdx];
  const previewStart = Math.max(0, currentIdx - 2);
  const previewEnd = Math.min(totalSyllables, currentIdx + 8);
  const previewSlice = allSyllables.slice(previewStart, previewEnd);

  const progress = audioDuration > 0 ? (currentMs / audioDuration) * 100 : 0;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "#0D0D0D",
      display: "flex", flexDirection: "column",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: "#F0EDE6",
    }}>
      <audio ref={audioRef} style={{ display: "none" }} />

      {/* Header */}
      <div style={{
        padding: "16px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#E8A020", textTransform: "uppercase", fontFamily: "monospace" }}>
            MODO SINCRONIZAÇÃO
          </div>
          <div style={{ fontSize: 16, fontStyle: "italic", marginTop: 2 }}>
            {song.title}
          </div>
        </div>
        <button onClick={onCancel} style={{
          background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "6px 14px",
          cursor: "pointer", fontSize: 13,
        }}>✕ Fechar</button>
      </div>

      {/* Progress */}
      <div style={{ padding: "12px 24px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
            Sílaba {currentIdx}/{totalSyllables}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
            {Math.floor(currentMs / 60000)}:{String(Math.floor((currentMs % 60000) / 1000)).padStart(2, "0")}
          </span>
        </div>
        <div style={{
          height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            background: "#E8A020",
            width: `${(currentIdx / totalSyllables) * 100}%`,
            transition: "width 0.15s ease",
          }} />
        </div>
        {/* Audio progress */}
        <div style={{
          height: 2, borderRadius: 1,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginTop: 4,
        }}>
          <div style={{
            height: "100%", borderRadius: 1,
            background: "rgba(232,160,32,0.4)",
            width: `${progress}%`,
          }} />
        </div>
      </div>

      {/* Syllable preview */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "20px 24px",
        gap: 24,
      }}>
        {/* Current syllable - big */}
        {currentSyl ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", color: currentSyl.sectionColor, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 8 }}>
              PRÓXIMA SÍLABA
            </div>
            <div style={{
              fontSize: 64, fontStyle: "italic", fontWeight: 600,
              color: currentSyl.sectionColor,
              textShadow: `0 0 40px ${currentSyl.sectionColor}60`,
              lineHeight: 1,
            }}>
              {currentSyl.text === " " ? "⎵" : currentSyl.text === "-" ? "—" : currentSyl.text}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 28, fontStyle: "italic", color: "#4ECDC4" }}>
            ✓ Sincronização completa!
          </div>
        )}

        {/* Context line */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "0 3px",
          justifyContent: "center", alignItems: "baseline",
          padding: "16px 20px", borderRadius: 12,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          maxWidth: 600,
        }}>
          {previewSlice.map((syl, i) => {
            const globalI = previewStart + i;
            const isCurrent = globalI === currentIdx;
            const isPast = globalI < currentIdx;
            return (
              <span key={globalI} style={{
                fontSize: isCurrent ? 28 : 20,
                fontStyle: "italic",
                fontWeight: isCurrent ? 700 : 400,
                color: isCurrent
                  ? syl.sectionColor
                  : isPast
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(255,255,255,0.5)",
                transition: "all 0.15s ease",
              }}>
                {syl.text}
              </span>
            );
          })}
        </div>

        {/* Last tap info */}
        {taps.length > 0 && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
            Último tap: {(taps[taps.length - 1].startMs / 1000).toFixed(2)}s
            {" — "}
            sílaba "{allSyllables[taps.length - 1]?.text}"
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{
        padding: "12px 24px",
        textAlign: "center",
        color: "rgba(255,255,255,0.3)",
        fontSize: 12,
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}>
        {isDone
          ? "Clique em \"Salvar\" para aplicar a sincronização"
          : isPlaying
          ? "Toque o botão ou pressione ESPAÇO quando ouvir cada sílaba · BACKSPACE para desfazer"
          : "Pressione ▶ para iniciar o áudio, depois toque no ritmo"
        }
      </div>

      {/* Controls */}
      <div style={{
        padding: "16px 24px 24px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      }}>
        <button onClick={handleRestart} style={{
          background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255,255,255,0.6)", borderRadius: "50%", width: 44, height: 44,
          cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
        }}>↺</button>

        <button onClick={togglePlay} style={{
          background: isPlaying ? "rgba(255,255,255,0.1)" : "#E8A020",
          border: "none",
          color: isPlaying ? "#F0EDE6" : "#000",
          borderRadius: "50%", width: 48, height: 48,
          cursor: "pointer", fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {isPlaying ? "⏸" : "▶"}
        </button>

        {/* TAP BUTTON */}
        {!isDone && (
          <button
            onClick={handleTap}
            disabled={!isPlaying}
            style={{
              background: isPlaying ? "#4ECDC4" : "rgba(255,255,255,0.05)",
              border: "none",
              color: isPlaying ? "#000" : "rgba(255,255,255,0.2)",
              borderRadius: 16, padding: "14px 32px",
              cursor: isPlaying ? "pointer" : "not-allowed",
              fontSize: 18, fontWeight: 700, letterSpacing: "0.06em",
              fontFamily: "monospace",
              transition: "all 0.1s ease",
            }}>
            TAP
          </button>
        )}

        <button onClick={handleUndo} disabled={taps.length === 0} style={{
          background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
          color: taps.length > 0 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.15)",
          borderRadius: "50%", width: 44, height: 44,
          cursor: taps.length > 0 ? "pointer" : "not-allowed",
          fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
        }}>↩</button>

        {isDone && (
          <button onClick={handleSave} style={{
            background: "#4ECDC4", border: "none",
            color: "#000", borderRadius: 12, padding: "12px 28px",
            cursor: "pointer", fontSize: 16, fontWeight: 600,
            boxShadow: "0 0 20px rgba(78,205,196,0.4)",
          }}>
            ✓ Salvar Sincronização
          </button>
        )}
      </div>
    </div>
  );
}
