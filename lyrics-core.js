"use strict";

(function exposeLyricsCore(globalObject) {
  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\([^)]*(remaster|version|edit|mix|live|feat|ft\.)[^)]*\)/g, "")
      .replace(/\[[^\]]*(remaster|version|edit|mix|live|feat|ft\.)[^\]]*\]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseSyncedLyrics(source) {
    const parsed = [];

    String(source || "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const stamps = Array.from(
          rawLine.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g),
        );
        if (!stamps.length) return;

        const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
        stamps.forEach((stamp) => {
          const minutes = Number(stamp[1]);
          const seconds = Number(stamp[2]);
          if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return;
          parsed.push({
            timeMs: Math.round((minutes * 60 + seconds) * 1000),
            text,
          });
        });
      });

    return parsed
      .filter((line) => line.timeMs >= 0)
      .sort((left, right) => left.timeMs - right.timeMs);
  }

  function scoreResult(result, target) {
    let score = 0;
    const wantedTitle = normalize(target.trackName);
    const wantedArtist = normalize(target.artistName);
    const resultTitle = normalize(result?.trackName);
    const resultArtist = normalize(result?.artistName);

    if (wantedTitle && resultTitle === wantedTitle) score += 60;
    else if (
      wantedTitle &&
      resultTitle &&
      (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle))
    ) {
      score += 35;
    }

    if (wantedArtist && resultArtist === wantedArtist) score += 35;
    else if (
      wantedArtist &&
      resultArtist &&
      (resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist))
    ) {
      score += 18;
    }

    const wantedDuration = Number(target.duration);
    const resultDuration = Number(result?.duration);
    if (Number.isFinite(wantedDuration) && Number.isFinite(resultDuration)) {
      const difference = Math.abs(wantedDuration - resultDuration);
      if (difference <= 2) score += 25;
      else if (difference <= 5) score += 15;
      else if (difference <= 10) score += 5;
      else score -= Math.min(30, difference / 2);
    }

    if (result?.syncedLyrics) score += 8;
    else if (result?.plainLyrics) score += 3;
    return score;
  }

  function chooseBestResult(results, target) {
    const candidates = Array.isArray(results) ? results.filter(Boolean) : [];
    if (!candidates.length) return null;

    return candidates
      .map((result) => ({ result, score: scoreResult(result, target) }))
      .sort((left, right) => right.score - left.score)[0].result;
  }

  globalObject.J2Lyrics = {
    chooseBestResult,
    normalize,
    parseSyncedLyrics,
  };
})(typeof window === "undefined" ? globalThis : window);
