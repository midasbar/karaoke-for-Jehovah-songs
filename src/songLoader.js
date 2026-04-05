const SYNC_KEY_PREFIX = "sync_";

export async function loadSong(songId) {
  const res = await fetch(`/songs/${songId}/song.json`);
  if (!res.ok) throw new Error(`Failed to load song: ${songId}`);
  const data = await res.json();
  return {
    ...data,
    songId,
    audioUrl: (fileName) => `/songs/${songId}/${fileName}`,
  };
}

export async function loadSyncFromFile(songId) {
  try {
    const res = await fetch(`/songs/${songId}/sync.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function buildTimeline(song, syncData) {
  const flat = [];
  let globalIdx = 0;

  if (syncData?.syllableTimings?.length) {
    // Use synced absolute timestamps
    const timings = syncData.syllableTimings;
    song.sections.forEach((section) => {
      section.lines.forEach((line) => {
        line.syllables.forEach((syl) => {
          const timing = timings.find((t) => t.idx === globalIdx);
          const nextTiming = timings.find((t) => t.idx === globalIdx + 1);
          const startMs = timing ? timing.startMs : 0;
          const endMs = nextTiming ? nextTiming.startMs : startMs + syl.dur;
          flat.push({
            ...syl,
            sectionId: section.id,
            sectionLabel: section.label,
            sectionColor: section.color,
            lineId: line.id,
            startMs,
            endMs,
          });
          globalIdx++;
        });
      });
    });
  } else {
    // Fallback: relative durations with intro offset
    let globalMs = song.introMs || 22000;
    song.sections.forEach((section) => {
      section.lines.forEach((line) => {
        line.syllables.forEach((syl) => {
          flat.push({
            ...syl,
            sectionId: section.id,
            sectionLabel: section.label,
            sectionColor: section.color,
            lineId: line.id,
            startMs: globalMs,
            endMs: globalMs + syl.dur,
          });
          globalMs += syl.dur;
        });
        globalMs += 200;
      });
      globalMs += 400;
    });
  }

  const totalMs = flat.length > 0 ? flat[flat.length - 1].endMs + 1000 : 0;
  return { flat, totalMs };
}

export function saveSyncData(songId, data) {
  const key = SYNC_KEY_PREFIX + songId;
  const payload = {
    songId,
    syncedAt: new Date().toISOString(),
    syllableTimings: data,
  };
  localStorage.setItem(key, JSON.stringify(payload));
  return payload;
}

export function loadSyncData(songId) {
  const key = SYNC_KEY_PREFIX + songId;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSyncData(songId) {
  localStorage.removeItem(SYNC_KEY_PREFIX + songId);
}

export function exportSyncData(songId) {
  const data = loadSyncData(songId);
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sync_${songId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importSyncData(songId, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.syllableTimings) {
          reject(new Error("Invalid sync file"));
          return;
        }
        const key = SYNC_KEY_PREFIX + songId;
        localStorage.setItem(key, JSON.stringify({ ...data, songId }));
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
