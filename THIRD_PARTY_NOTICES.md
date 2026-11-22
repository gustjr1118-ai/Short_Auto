# Third-party components

- Electron: MIT, https://github.com/electron/electron. Chromium and bundled third-party notices are included with the Electron distribution.
- React / React DOM: MIT, https://github.com/facebook/react.
- SQL.js / SQLite: SQL.js MIT, SQLite public domain. https://github.com/sql-js/sql.js.
- FFmpeg Windows release essentials: Gyan Doshi build, linked from https://ffmpeg.org/download.html. Bundled executable is unmodified. Its GPL license and full build README are in `assets/tools/licenses/` (packaged: `resources/tools/licenses/`). Source revision and build/library information are documented by the vendor at https://www.gyan.dev/ffmpeg/builds/ and https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/946fcce07b.
- yt-dlp: https://github.com/yt-dlp/yt-dlp. Source is Unlicense; the Windows standalone executable includes third-party software under its respective licenses. Upstream licensing details: https://github.com/yt-dlp/yt-dlp#license.
- whisper.cpp Windows CPU runtime: unmodified CLI and runtime DLLs from https://github.com/ggml-org/whisper.cpp/releases/tag/b5127. MIT notices accompany the runtime under `resources/tools/whisper/`.
- Whisper multilingual base model, GGML Q5_1 conversion: https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-base-q5_1.bin. Original model and MIT license: https://github.com/openai/whisper. The model license is included alongside the runtime.
- UI benchmarking reference: YouTube Finder bySom / Boks YouTube Finder, README identifies MIT, © 2026 복사장. This app uses its visual tokens and desktop interaction patterns as a reference.
- Korean rendering font: Malgun Gothic is resolved from the user's Windows installation and copied into a local render working folder at runtime; it is not bundled in this application distribution.
