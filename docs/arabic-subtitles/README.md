# Arabic subtitle repair and translation status

Unofficial Linux x86_64 Seanime 3.10.4 build, forked from [5rahim/seanime](https://github.com/5rahim/seanime). Developed with assistance from OpenAI Codex on 2026-10-26. Original attribution and licenses remain in place.

## Download and run

Download `Seanime-3.10.4-Arabic-Fixed-5.AppImage` and `SHA256SUMS` from [release 4](https://github.com/Elias966/seanime/releases/tag/v3.10.4-arabic-fix.5). Close any running Seanime instance, then:

```sh
sha256sum -c SHA256SUMS
chmod +x Seanime-3.10.4-Arabic-Fixed-5.AppImage
./Seanime-3.10.4-Arabic-Fixed-5.AppImage
```

Python 3 is required; no pip packages are needed. The build uses the existing Seanime profile. The launcher starts the bundled local helper on `127.0.0.1:11435`, or reuses a compatible already-running helper. Helper revision is checked so an older helper cannot silently override these fixes. If an old standalone service occupies this port, update it or stop it before opening the AppImage:

```sh
systemctl --user disable --now seanime-translation-helper.service
```

That command is only relevant when the previous standalone helper was installed. The AppImage can start its bundled helper itself.

## Translation settings

For local Ollama:

- Provider: OpenAI-compatible
- Base URL: `http://127.0.0.1:11435/v1`
- Model: `gemma4:e2b`
- Target language: Arabic

Ollama itself remains at `http://127.0.0.1:11434`. All model requests stay local; no cloud fallback or model weights are bundled. Keep Ollama running.

**Restart Seanime and reload the episode/subtitle track after upgrading**, because old untranslated results can remain in the player/backend caches. The user also reported that toggling translation mode away and back after changing models helped stale model selection.

## Release 5: prevent skipped captions under full-episode load

The previous player could submit an episode's subtitle requests without a concurrency limit. With a single local model generation slot, later requests exhausted the helper's 50-second deadline while waiting. The last-session logs showed deadline failures, source-language fallbacks and disconnected callers.

The player also kept only one waiting event per source text. Repeated dialogue overwrote earlier waiters, so some caption occurrences could receive no translated event even when the translation request succeeded.

Release 5 fixes the actual player delivery path:

- At most **four unique subtitle requests** are in flight. Remaining work stays queued in the player, before server request deadlines begin.
- One result is delivered to **every occurrence** of repeated dialogue, preserving each caption's own time, duration and style. Successful duplicate text can reuse its result.
- After seeking, queued dialogue at/after the current position takes priority over stale earlier work.
- Lost replies retry once; destroying the manager cancels pending timers/work.
- Progress includes the unsent backlog, so four active requests do not hide the rest of the episode's pending captions.
- The helper retries temporary local HTTP/network failures. A failed stuttered line gets a retry with repeated short hyphen fragments normalized; original caption metadata and timing remain intact.

Implementation: [`subtitle-translation-queue.js`](../../seanime-web/public/subtitle-translation-queue.js) and the updated [`VideoCoreSubtitleManager`](../../seanime-web/src/app/(main)/_features/video-core/video-core-subtitles.ts). The packager patches the exact corresponding official compiled manager using a fail-closed [patch recipe](../../scripts/patch_subtitle_scheduler.py). Changed frontend assets receive new content-addressed filenames and the runtime chunk map/index are updated, preventing old cached URLs from selecting the pre-fix manager.

![Bounded requests with the complete backlog counted](translation-queue-preview.png)

### Full-track regression

The complete English subtitle track from the user's last played local episode was tested, not a short sample. The private media path and dialogue text are excluded from published files.

The final harness runs the **actual patched compiled manager methods**, bounded queue, local helper and real `gemma4:e2b`, simulating Seanime's 100 ms batching. It delivered **362/362 caption events with Arabic text**, using **354 raw requests / 89 HTTP batches**, at most **4 outstanding requests**, **0 request errors**, in **98.18 seconds**. Every delivered event retained its original start time, duration and style. Repeated events were included individually. [Aggregate results](validation-release-5.json).

This verifies whole-track translation/delivery and script checks, not independent semantic review, uninterrupted video playback, or visual inspection of every caption. An initial bounded helper test found one stuttered source line; full manager testing additionally exposed a source-specific Ollama HTTP 500 on that line. The final retry path handled it and the full track passed.

A browser fixture using the actual patched manager methods also verified the complete backlog counter and 103 caption deliveries from 100 unique requests when a caption was repeated three more times. The unit suite passed **11 helper tests and 15 progress/queue tests**, including the actual compiled manager adapter.

Static artifact analysis was scoped to the compiled manager and progress script in release 4 (REA parent evidence `ev_621bbf36206da6ee8cd9a7424f0d178ca5e524bcdba4c88cacb887e51b4734e4`). Its graph is partial and does not prove execution; the runtime tests described above supply the delivery evidence.

## Release 4: avoid false completion and whole-batch fallback

Earlier status logic could report completion after all requests returned, even when some returned original dialogue. A file with a single Arabic line could also be treated as ready despite untranslated dialogue elsewhere. Release 4 changes that behavior:

- Checks individual returned subtitle lines, including lines inside whole ASS/SRT/VTT files.
- Recognizes untranslated Japanese, Cyrillic, Chinese and other scripts, single English words, and obvious mixed-language output.
- Shows **Translation incomplete** while untranslated, mixed-language, timed-out or unverified results remain. It does not use the old "Translation finished" message.
- Percentage measures **Arabic-ready results / known lines**, rather than merely counting replies. Punctuation/music-only lines are neutral and do not require Arabic text.
- Processing a queue fully does not turn untranslated lines into success. For example, 25 Arabic lines and 75 original lines show **25%**, even though 100 requests have been processed.

These are script checks and heuristics. They do **not** verify the meaning of a translation, catch every foreign word, or guarantee translation accuracy. "Arabic results received" describes returned Arabic-script content, not verified semantic correctness. Proper names may be flagged conservatively; local retries ask for Arabic transliteration.

![Fully processed queue correctly marked incomplete](translation-incomplete-preview.png)

The local helper also fixes failure handling:

- Gemma 4 receives **one subtitle line per prompt**, preserving item IDs. In a real mixed-language batch, the model returned unrelated Arabic for several items; the same source lines translated correctly individually.
- Normal requests disable reasoning for speed. A failed line gets one additional reasoning-enabled attempt.
- A persistently failing line retains its source text and is reported as incomplete. It does not discard translations that succeeded for other lines.
- No source text is logged. Logs record timings, repair counts and untranslated counts.

Persistently failing source lines can be cached by Seanime; restart/reload to retry them after resolving a model issue. This package does not modify the backend's caching or provider behavior.

## Progress indicator

A compact top-left overlay observes existing player WebSocket requests and results. It works for translation into Arabic from any source language and is independent of provider: Ollama, Google, etc.

For event tracks it shows Arabic-ready results, percentage, processed lines, pending lines, untranslated/mixed-language results and timeouts. The denominator includes observed requests and the bounded scheduler backlog, and can increase as more subtitle events arrive. Repeated source text can share one translation job while all caption occurrences receive its result. It is not an estimate of every line in the whole episode.

For whole subtitle files the existing backend provides no intermediate line counts. The overlay shows activity until the file returns, then inspects its dialogue. It does not invent an intermediate file percentage. Requests without a response after 75 seconds and files still pending after five minutes produce warnings; late responses can still update status.

The overlay supports DOM fullscreen, resets for a new episode, ignores mouse input, respects reduced-motion settings and has accessible status labels. Successful received results hide after ten seconds; incomplete results remain visible. Disabled translation and non-Arabic targets hide it.

Implementation: [`seanime-web/public/translation-progress.js`](../../seanime-web/public/translation-progress.js), loaded before the existing frontend scripts. It observes messages without rewriting them.

## Arabic font repair

The packaged JASSUB/libass WebAssembly renderer did not reliably select an Arabic-capable font. The default Roboto lacks Arabic, embedded fonts vary by episode, and some multi-style subtitle tracks bypass user font customization. Installing a Linux font alone did not solve the tested cases.

The repair bundles unmodified DejaVu Sans and its license, loads it in JASSUB before rendering, and applies explicit font selection to Arabic-containing events. It covers initial ASS content, track replacements, live MKV event creation/updates, inline font changes and style resets. Timing, placement, colors and other ASS properties are retained; font selection changes only on Arabic-containing events. It cannot recover text already replaced with literal square characters or fix mistranslations.

[Original square-glyph fixture](subtitles-before.png) · [Repaired rendering](subtitles-repaired.png).

Implementation: [`seanime-web/public/jassub/jassub-worker.js`](../../seanime-web/public/jassub/jassub-worker.js). Updating/transpiling JASSUB can overwrite this direct vendor patch.

## Rebuild

The release repackages the official [3.10.4 Linux x86_64 AppImage](https://github.com/5rahim/seanime/releases/tag/v3.10.4), whose SHA256 is:

```text
bc1d3b5b045b1be1378f4501afc436bf282c052d5fb254513addf2e3af7014f5
```

The script preserves the original runtime, extracts SquashFS, rewrites Electron ASAR offsets/integrity metadata, and repacks with xz. Eight ASAR entries are added or changed from upstream: the worker, font, font license, content-addressed progress/queue scripts, patched player chunk, updated runtime bootstrap, and `index.html`. The index loads the new bootstrap, whose chunk map selects the patched player. It preserves the original `AppRun` as `AppRun.upstream`, installs a helper startup wrapper, and adds `resources/seanime-translation-helper.py`. The Go backend, Electron and WebAssembly binaries are unchanged.

Check out the release tag, install Python 3 and `squashfs-tools`, then:

```sh
python3 scripts/repack-arabic-appimage.py \
  /path/to/seanime-denshi-3.10.4_Linux_x86_64.AppImage \
  ./Seanime-3.10.4-Arabic-Fixed-5.AppImage
```

The script verifies the official image and original worker hashes. Allow several GB of temporary disk space. Filesystem timestamps/tool versions can change the final compressed AppImage checksum; `SHA256SUMS` applies to the uploaded asset.

## Tests and limitations

```sh
python3 -m unittest discover -s scripts/arabic-translation -v
node --test scripts/arabic-translation/test-progress.cjs scripts/arabic-translation/test-subtitle-queue.cjs
# To test the compiled adapter too, set SEANIME_PLAYER_BUNDLE to the extracted patched 9195.*.js path.
```

Release 4 passed eight helper and eight progress tests. Regression cases include partial batch failure, a second-attempt recovery, Gemma per-line prompts, non-Latin text, mixed output, missing rows, file-level partial translation, duplicate dialogue, late responses, settings races and episode resets. Browser checks reproduced a fully processed queue with untranslated lines and verified the incomplete status/percentage.

An eight-line real local Gemma test containing English, Japanese, Russian, Chinese, French, Spanish and a proper name completed in 1.25 seconds, with Arabic results for every line. The tested Japanese, Russian and Chinese lines had unrelated meanings in a batched request; the individual prompts returned relevant translations. This is a small regression sample, not a guarantee of accuracy or continuous playback of every episode.

Earlier font tests used the actual packaged JavaScript/WASM renderer for Arabic, diacritics, Latin/Arabic mixtures, punctuation, multiple ASS styles and inline font overrides. Live event updates and representative samples from three episode ASS tracks were rendered in the repaired Electron runtime.

## Rollback and licenses

To remove the local translation helper from the request path, change the base URL back to `http://127.0.0.1:11434/v1`. Close this build and open the original official AppImage. Both use the existing profile. Future official updates may replace the repair; it is not integrated upstream.

Seanime retains its upstream GPL-3.0 license. DejaVu Sans retains its [included font license](../../seanime-web/public/fonts/DejaVuSans.LICENSE.txt). Other bundled dependencies retain their original notices.
