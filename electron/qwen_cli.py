"""Generate WAV files with the installed Qwen3-TTS CustomVoice model."""
import argparse
import json
from pathlib import Path

import soundfile
import torch
from qwen_tts import Qwen3TTSModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("request", type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(
        str(args.model),
        device_map=device if device.startswith("cuda") else None,
        dtype=torch.float16 if device.startswith("cuda") else torch.float32,
        attn_implementation="sdpa",
        local_files_only=True,
    )
    for row in request["lines"]:
        waveforms, sample_rate = model.generate_custom_voice(
            text=row["text"],
            language=request["language"],
            speaker=request["speaker"],
        )
        dest = args.request.parent / (row["id"] + ".wav")
        soundfile.write(dest, waveforms[0], sample_rate, subtype="PCM_16")


if __name__ == "__main__":
    main()
