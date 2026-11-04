"""Regenerate SKILL.md from SKILL_body.md and the scripts, so its embedded copies always match.

Run from anywhere:  python build_skill.py
Then check it from a cold start: python build_skill.py --extract EMPTY_FOLDER writes the embedded files
out of SKILL.md, and the test routes should run from there.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FRONT = """---
name: png2cad
description: Convert a PNG/JPG image of line art or a flat-color logo into CAD and print files, clean DXFs for Onshape, scalable SVGs for Affinity and Illustrator, and 3MF test plates for Bambu/Orca, sized in mm or inches and fitted to nozzle sizes, with verification.
---

"""
INTRO = """## Embedded files

Write each file below to the path in its heading (relative to a working folder), unchanged.
"""
FILES = ["scripts/dxf_io.py", "scripts/make_labels.py", "scripts/nozzle.py", "scripts/pipeline.py",
         "scripts/labels_to_dxf.py", "scripts/verify_dxf.py", "scripts/labels_to_svg.py", "scripts/verify_svg.py",
         "scripts/mesh3mf.py", "scripts/bambu_profile.py", "scripts/labels_to_3mf.py", "scripts/verify_3mf.py",
         "scripts/rebuild_helpers.py", "scripts/measure.py", "examples/shield_rebuild.py"]


def read(path):
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def build():
    on_disk = {p.relative_to(ROOT).as_posix() for d in ("scripts", "examples") for p in (ROOT / d).glob("*.py")}
    if on_disk != set(FILES):
        raise SystemExit(f"FILES is out of step with the folder: {sorted(on_disk ^ set(FILES))}")
    parts = [FRONT, read(ROOT / "SKILL_body.md").rstrip("\n"), "\n\n", INTRO]
    for name in FILES:
        parts.append(f"\n### `{name}`\n\n```python\n{read(ROOT / name).rstrip(chr(10))}\n```\n")
    (ROOT / "SKILL.md").write_bytes("".join(parts).encode("utf-8"))
    print(f"SKILL.md: {len(FILES)} files embedded")


def extract(folder):
    text = read(ROOT / "SKILL.md")
    found = re.findall(r"^### `([^`]+)`\n\n```python\n(.*?)^```\n", text, flags=re.M | re.S)
    for name, code in found:
        path = pathlib.Path(folder) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(code.encode("utf-8"))
    print(f"{len(found)} files written to {folder}")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--extract":
        extract(sys.argv[2])
    else:
        build()
