#!/usr/bin/env python3
"""
Sync Generator for Cantico Karaoke
Uses OpenAI Whisper to extract word-level timestamps from the sung MP3,
then maps them to the syllable structure in song.json to produce sync data.

Usage:
    pip install openai-whisper
    python3 sync_generator.py

Output: public/songs/cantico-160/sync.json (importable in the app)
"""

import json
import os
import re
import sys
import unicodedata

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SONG_DIR = os.path.join(SCRIPT_DIR, "public", "songs", "cantico-160")
SONG_JSON = os.path.join(SONG_DIR, "song.json")
AUDIO_FILE = os.path.join(SONG_DIR, "sjjc_T_160.mp3")
OUTPUT_FILE = os.path.join(SONG_DIR, "sync.json")


def normalize(text):
    """Normalize text for comparison: lowercase, strip accents, strip punctuation."""
    text = text.strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r'[^a-z0-9\s]', '', text)
    return text.strip()


def extract_words_from_section(section):
    """Extract words from a single section's syllables. Returns list of { word, local_indices }."""
    words = []
    current_word = ""
    current_indices = []
    local_idx = 0

    for line in section["lines"]:
        if current_word:
            words.append({"word": current_word, "indices": current_indices[:]})
            current_word = ""
            current_indices = []
        for syl in line["syllables"]:
            text = syl["text"]
            if text.strip() == "":
                if current_word:
                    words.append({"word": current_word, "indices": current_indices[:]})
                    current_word = ""
                    current_indices = []
                words.append({"word": " ", "indices": [local_idx]})
                local_idx += 1
                continue
            if text == "-":
                current_indices.append(local_idx)
                local_idx += 1
                continue
            if text.startswith(" "):
                if current_word:
                    words.append({"word": current_word, "indices": current_indices[:]})
                current_word = text.strip()
                current_indices = [local_idx]
            else:
                current_word += text
                current_indices.append(local_idx)
            local_idx += 1
    if current_word:
        words.append({"word": current_word, "indices": current_indices[:]})
    return words


def get_section_global_offset(song, section_id):
    """Get the global syllable index offset for a section."""
    offset = 0
    for s in song["sections"]:
        if s["id"] == section_id:
            return offset
        for line in s["lines"]:
            offset += len(line["syllables"])
    return offset


def extract_playback_words(song):
    """
    Extract words in playbackOrder, mapping local indices to global song.json indices.
    Returns list of { word, global_indices } in the order they appear in the audio.
    """
    playback_order = song.get("playbackOrder", [s["id"] for s in song["sections"]])
    sections_by_id = {s["id"]: s for s in song["sections"]}

    all_words = []
    for section_id in playback_order:
        section = sections_by_id[section_id]
        global_offset = get_section_global_offset(song, section_id)
        section_words = extract_words_from_section(section)
        for w in section_words:
            all_words.append({
                "word": w["word"],
                "indices": [i + global_offset for i in w["indices"]],
                "section_id": section_id,
            })
    return all_words


def get_lyrics_text(song):
    """Reconstruct plain lyrics text from syllables (section order) for Whisper prompt."""
    lines = []
    for section in song["sections"]:
        for line in section["lines"]:
            text = ""
            for syl in line["syllables"]:
                t = syl["text"]
                if t == "-":
                    continue
                text += t
            lines.append(text.strip())
    return " ".join(lines)


def run_whisper(audio_path, model_name="small", initial_prompt=""):
    """Run Whisper on the audio file and return word-level timestamps."""
    try:
        import whisper
    except ImportError:
        print("❌ openai-whisper não está instalado.")
        print("   Instale com: pip install openai-whisper")
        sys.exit(1)

    print(f"🔄 Carregando modelo Whisper '{model_name}'...")
    model = whisper.load_model(model_name)

    print(f"🎵 Transcrevendo '{os.path.basename(audio_path)}'...")
    if initial_prompt:
        print(f"   (com prompt: '{initial_prompt[:80]}...')")

    result = model.transcribe(
        audio_path,
        language="pt",
        word_timestamps=True,
        condition_on_previous_text=True,
        initial_prompt=initial_prompt or None,
    )

    whisper_words = []
    for segment in result["segments"]:
        if "words" not in segment:
            continue
        for w in segment["words"]:
            whisper_words.append({
                "word": w["word"].strip(),
                "start": w["start"],
                "end": w["end"],
            })

    print(f"✅ Whisper detectou {len(whisper_words)} palavras")
    return whisper_words, result["text"]


def levenshtein_ratio(s1, s2):
    """Compute similarity ratio between two strings (0-100)."""
    if not s1 or not s2:
        return 0
    len1, len2 = len(s1), len(s2)
    matrix = [[0] * (len2 + 1) for _ in range(len1 + 1)]
    for i in range(len1 + 1):
        matrix[i][0] = i
    for j in range(len2 + 1):
        matrix[0][j] = j
    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            cost = 0 if s1[i-1] == s2[j-1] else 1
            matrix[i][j] = min(
                matrix[i-1][j] + 1,
                matrix[i][j-1] + 1,
                matrix[i-1][j-1] + cost,
            )
    dist = matrix[len1][len2]
    max_len = max(len1, len2)
    return int((1 - dist / max_len) * 100) if max_len > 0 else 100


def align_words(song_words, whisper_words):
    """Align Whisper-detected words to song word list using fuzzy matching."""
    aligned = []
    w_idx = 0

    for sw in song_words:
        if sw["word"].strip() == "" or sw["word"] == " ":
            aligned.append({"song_word": sw, "whisper_match": None})
            continue

        norm_song = normalize(sw["word"])
        if not norm_song:
            aligned.append({"song_word": sw, "whisper_match": None})
            continue

        best_match = None
        best_score = 0
        search_end = min(w_idx + 12, len(whisper_words))

        for i in range(w_idx, search_end):
            norm_whisper = normalize(whisper_words[i]["word"])
            if not norm_whisper:
                continue

            # Exact match
            if norm_song == norm_whisper:
                best_match = i
                best_score = 100
                break

            # Levenshtein similarity
            sim = levenshtein_ratio(norm_song, norm_whisper)

            # For very short words (1-2 chars), require exact or near-exact match
            if len(norm_song) <= 2:
                if norm_song == norm_whisper:
                    best_match = i
                    best_score = 100
                    break
                continue

            if sim >= 60 and sim > best_score:
                best_match = i
                best_score = sim

            # Starts-with match
            if norm_whisper.startswith(norm_song) or norm_song.startswith(norm_whisper):
                score = max(80, sim)
                if score > best_score:
                    best_match = i
                    best_score = score

            # Substring match
            if norm_song in norm_whisper or norm_whisper in norm_song:
                score = max(70, sim)
                if score > best_score:
                    best_match = i
                    best_score = score

        if best_match is not None and best_score >= 75:
            aligned.append({"song_word": sw, "whisper_match": whisper_words[best_match], "score": best_score})
            w_idx = best_match + 1
        else:
            aligned.append({"song_word": sw, "whisper_match": None, "score": 0})

    return aligned


def generate_syllable_timings(aligned, song):
    """
    From word-level alignment, distribute timing across syllables
    proportionally based on original dur values.
    """
    all_syls = []
    for section in song["sections"]:
        for line in section["lines"]:
            for syl in line["syllables"]:
                all_syls.append(syl)

    total_syllables = len(all_syls)
    timing_map = [None] * total_syllables

    for entry in aligned:
        sw = entry["song_word"]
        wm = entry["whisper_match"]
        if wm is None:
            continue

        indices = sw["indices"]
        if not indices:
            continue

        word_start_ms = int(wm["start"] * 1000)
        word_end_ms = int(wm["end"] * 1000)
        word_dur = word_end_ms - word_start_ms

        total_orig_dur = sum(all_syls[i]["dur"] for i in indices if i < total_syllables)
        if total_orig_dur == 0:
            total_orig_dur = 1

        cursor = word_start_ms
        for idx in indices:
            if idx >= total_syllables:
                continue
            proportion = all_syls[idx]["dur"] / total_orig_dur
            syl_dur = int(word_dur * proportion)
            timing_map[idx] = cursor
            cursor += syl_dur

    # Fill gaps via interpolation
    last_known = None
    for i in range(total_syllables):
        if timing_map[i] is not None:
            last_known = timing_map[i]
        elif last_known is not None and i > 0:
            timing_map[i] = last_known + all_syls[i - 1]["dur"]
            last_known = timing_map[i]

    timings = []
    for i, ms in enumerate(timing_map):
        if ms is not None:
            timings.append({"idx": i, "startMs": ms})

    return timings


def main():
    print(f"📖 Lendo {SONG_JSON}...")
    with open(SONG_JSON, "r", encoding="utf-8") as f:
        song = json.load(f)

    playback_order = song.get("playbackOrder", [s["id"] for s in song["sections"]])
    print(f"   Ordem de reprodução: {' → '.join(playback_order)}")

    playback_words = extract_playback_words(song)
    non_space = [w for w in playback_words if w["word"].strip()]
    print(f"📝 Estrutura da letra: {len(playback_words)} palavras ({len(non_space)} não-espaço)")
    for i, w in enumerate(playback_words[:10]):
        print(f"   {i}: '{w['word']}' [{w['section_id']}] → global sílabas {w['indices']}")
    print("   ...")

    if not os.path.exists(AUDIO_FILE):
        print(f"❌ Arquivo não encontrado: {AUDIO_FILE}")
        sys.exit(1)

    # Get lyrics text to use as Whisper prompt (improves accuracy)
    lyrics_prompt = get_lyrics_text(song)

    whisper_words, full_text = run_whisper(AUDIO_FILE, initial_prompt=lyrics_prompt)
    print(f"\n📝 Transcrição:\n   {full_text[:200]}...\n")

    print("🔍 Palavras detectadas pelo Whisper:")
    for i, w in enumerate(whisper_words):
        print(f"   {i:3d}: '{w['word']:<20s}' ({w['start']:.2f}s - {w['end']:.2f}s)")
    print()

    print("🔗 Alinhando palavras (na ordem de reprodução)...")
    aligned = align_words(playback_words, whisper_words)

    matched = sum(1 for a in aligned if a["whisper_match"] is not None)
    total = sum(1 for a in aligned if a["song_word"]["word"].strip())
    print(f"   Alinhadas: {matched}/{total} ({matched/total*100:.0f}%)\n")

    print("📋 Detalhes do alinhamento:")
    for a in aligned:
        sw = a["song_word"]["word"]
        if sw.strip() == "":
            continue
        wm = a["whisper_match"]
        score = a.get("score", 0)
        sid = a["song_word"].get("section_id", "?")
        if wm:
            print(f"   ✓ [{sid:7s}] '{sw:<18s}' → '{wm['word']:<18s}' @ {wm['start']:.2f}s (score: {score})")
        else:
            print(f"   ✗ [{sid:7s}] '{sw:<18s}' → SEM MATCH")
    print()

    print("\n⏱️  Gerando timestamps por sílaba...")
    timings = generate_syllable_timings(aligned, song)
    print(f"   {len(timings)} sílabas com timestamp")

    sync_data = {
        "songId": "cantico-160",
        "syncedAt": "auto-generated",
        "method": "whisper",
        "syllableTimings": timings,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sync_data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Sync salvo em: {OUTPUT_FILE}")
    print(f"   → Importe no app via ⚙ → 📥 Importar")

    # Show preview per-section
    all_syls = []
    for section in song["sections"]:
        for line in section["lines"]:
            for syl in line["syllables"]:
                all_syls.append({"text": syl["text"], "section": section["id"]})

    print("\n📊 Preview (primeiros 30 timestamps):")
    for t in timings[:30]:
        idx = t["idx"]
        syl_text = all_syls[idx]["text"] if idx < len(all_syls) else "?"
        sec = all_syls[idx]["section"] if idx < len(all_syls) else "?"
        print(f"   sílaba {idx:3d} [{sec:7s}]: {t['startMs']:6d}ms ({t['startMs']/1000:.2f}s) '{syl_text}'")


if __name__ == "__main__":
    main()
