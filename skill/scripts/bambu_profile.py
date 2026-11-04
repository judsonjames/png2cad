"""Build a Bambu Studio project settings file (Metadata/project_settings.config) from Bambu's own
system presets, so a plate opens in Bambu Studio as a project: printer, process and N filaments
already loaded, each part on its own filament, in the plate's colors.

Why: Bambu Studio 2.8.2+ refuses the settings of any 3MF without a printer configuration ("The 3mf
file has invalid config, load geometry data only") and then never adds the extra filament slots, so
the parts all land on filament 1. A file whose settings name a Bambu Lab printer_model is accepted.

Presets come from a Bambu Studio profile folder (resources/profiles/BBL in an install, or
%APPDATA%/BambuStudio/system/BBL). Each preset is resolved through its "inherits" chain and
"include" templates, the way Bambu Studio does, then the three are merged into one flat config.

    from bambu_profile import project_settings
    cfg = project_settings(profile_dir, "Bambu Lab X1 Carbon", 0.4, ["#A0A0A0", "#FFFFFF"])
"""
import json
import os

DEFAULT_PRINTER = "Bambu Lab X1 Carbon"
# per nozzle: the Bambu "Standard" process whose layer is half the nozzle (the inset assumes that)
PROCESS_FOR_NOZZLE = {0.2: "0.10mm Standard @BBL {short} 0.2 nozzle", 0.4: "0.20mm Standard @BBL {short}",
                      0.6: "0.30mm Standard @BBL {short} 0.6 nozzle", 0.8: "0.40mm Standard @BBL {short} 0.8 nozzle"}
FILAMENT_FOR_NOZZLE = {0.4: "Bambu PLA Basic @BBL {short}"}
FILAMENT_OTHER = "Bambu PLA Basic @BBL {short} {n:g} nozzle"
SHORT = {"Bambu Lab X1 Carbon": "X1C", "Bambu Lab X1": "X1", "Bambu Lab X1E": "X1E", "Bambu Lab P1S": "P1S",
         "Bambu Lab P1P": "P1P", "Bambu Lab A1": "A1", "Bambu Lab A1 mini": "A1M", "Bambu Lab P2S": "P2S"}


class Profiles:
    def __init__(self, root):
        self.root = root
        self.index = {}
        for sub in ("machine", "process", "filament"):
            d = os.path.join(root, sub)
            for dirpath, _, files in os.walk(d):
                for f in files:
                    if f.endswith(".json"):
                        try:
                            name = json.load(open(os.path.join(dirpath, f), encoding="utf-8")).get("name")
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if name:
                            self.index[(sub, name)] = os.path.join(dirpath, f)

    def resolve(self, kind, name):
        """Flat dict for a preset: parents first, then includes, then the preset's own keys."""
        path = self.index.get((kind, name))
        if path is None:
            raise KeyError(f"no {kind} preset named '{name}' in {self.root}")
        own = json.load(open(path, encoding="utf-8"))
        out = self.resolve(kind, own["inherits"]) if own.get("inherits") else {}
        for inc in own.get("include", []) or []:
            out.update({k: v for k, v in self.resolve(kind, inc).items() if k not in META})
        out.update(own)
        return out


META = {"name", "inherits", "from", "instantiation", "include", "type", "setting_id", "filament_id",
        "description", "renamed_from", "version", "is_custom_defined", "base_id"}


def preset_names(printer, nozzle):
    short = SHORT.get(printer)
    if short is None:
        raise SystemExit(f"--printer: no preset names known for '{printer}' (known: {', '.join(SHORT)})")
    n = round(float(nozzle), 1)
    machine = f"{printer} {n:g} nozzle"
    process = PROCESS_FOR_NOZZLE.get(n, "").format(short=short)
    filament = (FILAMENT_FOR_NOZZLE.get(n) or FILAMENT_OTHER).format(short=short, n=n)
    return machine, process, filament


def project_settings(profile_dir, printer, nozzle, colors, version="02.08.00.00"):
    """colors: '#RRGGBB' per filament, in filament order. Returns the settings as a dict that
    json.dump writes in Bambu's own project_settings.config format."""
    prof = Profiles(profile_dir)
    machine_name, process_name, filament_name = preset_names(printer, nozzle)
    machine = prof.resolve("machine", machine_name)
    process = prof.resolve("process", process_name)
    fil = prof.resolve("filament", filament_name)
    fil_id = json.load(open(prof.index[("filament", filament_name)], encoding="utf-8")).get("filament_id") \
        or fil.get("filament_id", "")
    n = len(colors)
    cfg = {}
    for src in (process, machine):
        cfg.update({k: v for k, v in src.items() if k not in META})
    # filament keys: every list repeated once per filament (Bambu stores one entry per filament)
    for k, v in fil.items():
        if k in META or k in ("compatible_printers", "compatible_prints", "compatible_printers_condition",
                              "compatible_prints_condition"):
            continue
        cfg[k] = (v * n) if isinstance(v, list) else v
    cfg.update({
        "filament_colour": [c.upper() for c in colors],
        "filament_settings_id": [filament_name] * n,
        "filament_ids": [fil_id] * n,
        "filament_self_index": [str(i + 1) for i in range(n) for _ in range(max(1, len(fil.get("filament_extruder_variant", ["x"]))))],
        "filament_map": ["1"] * n,
        "print_settings_id": process_name,
        "printer_settings_id": machine_name,
        "printer_model": machine.get("printer_model", printer),
        "inherits_group": [process_name] + [filament_name] * n + [machine_name],
        "different_settings_to_system": [""] * (n + 2),
        "from": "project",
        "name": "project_settings",
        "version": version,
    })
    for k in ("compatible_printers", "compatible_prints", "compatible_printers_condition",
              "compatible_prints_condition", "inherits"):
        cfg.pop(k, None)
    return cfg
