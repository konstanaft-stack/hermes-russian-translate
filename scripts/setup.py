#!/usr/bin/env python3
"""Explicit Windows x64 dependency setup. Standard library only; never starts a model.

Sources: official ggml-org/llama.cpp GitHub release asset SHA-256 metadata,
and tencent/Hy-MT2-1.8B-GGUF pinned Hugging Face LFS SHA-256 metadata.
No plugin source files or Hermes core files are fetched or replaced.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import sys
import tempfile
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = "b12017"
RELEASE_COMMIT = "5047748f114564fcf271e6a648f60e2d2eae6264"
RELEASE_METADATA = "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b12017"
MODEL_REVISION = "a0c709d9fac510f2c807aa3af52872340dc37a4a"
MODEL_NAME = "Hy-MT2-1.8B-Q8_0.gguf"
MODEL_METADATA = (
    "https://huggingface.co/api/models/tencent/Hy-MT2-1.8B-GGUF/revision/"
    + MODEL_REVISION + "?blobs=true"
)
MODEL = {
    "url": "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/"
           + MODEL_REVISION + "/" + MODEL_NAME,
    "size": 1908528192,
    "sha256": "5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4",
}
RUNTIMES = {
    "cpu": {
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12017/llama-b12017-bin-win-cpu-x64.zip",
        "size": 24574610,
        "sha256": "e89d351a603e91a9e3e944c4c4c4c4ccf5b4af6acbd44c5434b61bacfa3999b1f6",
    },
    "gpu": {
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b12017/llama-b12017-bin-win-vulkan-x64.zip",
        "size": 37514219,
        "sha256": "e3d43788fed7b2e5983320975cb21d91fbc2579698a497f0f8cecbe9c029312b",
    },
}


def hermes_home():
    if os.environ.get("HERMES_HOME"):
        return Path(os.environ["HERMES_HOME"]).expanduser().resolve()
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return (Path(os.environ["LOCALAPPDATA"]) / "hermes").resolve()
    return Path("~/.hermes").expanduser().resolve()


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def matches_asset(path, asset):
    path = Path(path)
    return (path.is_file() and not path.is_symlink()
            and path.stat().st_size == asset["size"]
            and file_sha256(path) == asset["sha256"])


def download_verified(asset, destination):
    """Keep valid files, verify bytes before atomic replacement, remove failed partials."""
    destination = Path(destination)
    if matches_asset(destination, asset):
        print("Already verified: " + destination.name)
        return False
    if not asset["url"].startswith("https://"):
        raise ValueError("Downloads require HTTPS")
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=destination.name + ".", suffix=".part", dir=destination.parent)
    try:
        digest = hashlib.sha256()
        total = 0
        progress = 0
        request = urllib.request.Request(asset["url"], headers={"User-Agent": "Hermes-Russian-Translate-Setup/1"})
        print("Downloading: " + asset["url"], flush=True)
        with os.fdopen(fd, "wb") as output:
            fd = None
            with urllib.request.urlopen(request, timeout=90) as response:
                # Official hosts redirect to their own object-storage/CDN URLs.
                final_url = response.geturl() if hasattr(response, "geturl") else asset["url"]
                if not final_url.startswith("https://"):
                    raise ValueError("Refusing a non-HTTPS redirect")
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > asset["size"]:
                        raise ValueError("Downloaded file is larger than the pinned asset")
                    output.write(chunk)
                    digest.update(chunk)
                    if total - progress >= 64 * 1024 * 1024:
                        print(f"  {total // (1024 * 1024)} / {asset['size'] // (1024 * 1024)} MiB", flush=True)
                        progress = total
            output.flush()
            os.fsync(output.fileno())
        if total != asset["size"] or digest.hexdigest() != asset["sha256"]:
            raise ValueError("SHA-256 or size mismatch; the existing file was kept")
        os.replace(temporary, destination)
        return True
    finally:
        if fd is not None:
            os.close(fd)
        Path(temporary).unlink(missing_ok=True)


def safe_member(name):
    name = name.replace("\\", "/")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or ":" in name or not path.parts:
        raise ValueError("Unsafe archive member: " + name)
    # Windows discards trailing spaces/dots and treats these names specially.
    reserved = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}
    if any(part.rstrip(" .") != part or part.split(".")[0].upper() in reserved for part in path.parts):
        raise ValueError("Unsafe Windows archive member: " + name)
    return path


def archive_inventory(archive):
    result = {}
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            path = safe_member(member.filename)
            if stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError("Symbolic links are not supported in runtime archives")
            if member.is_dir():
                continue
            key = path.as_posix()
            if key.casefold() in {name.casefold() for name in result}:
                raise ValueError("Duplicate archive member: " + key)
            if member.file_size > 512 * 1024 * 1024:
                raise ValueError("Unexpectedly large runtime archive member")
            digest = hashlib.sha256()
            with source.open(member) as data:
                for chunk in iter(lambda: data.read(1024 * 1024), b""):
                    digest.update(chunk)
            result[key] = {"sha256": digest.hexdigest(), "size": member.file_size}
    return result


def runtime_is_verified(directory, archive):
    """Compare extracted files with the pinned ZIP, not a user-editable receipt."""
    try:
        inventory = archive_inventory(archive)
        root = Path(directory).resolve()
        if not inventory or not root.is_dir() or Path(directory).is_symlink():
            return False
        actual_files = set()
        for path in root.rglob("*"):
            if path.is_symlink():
                return False
            if path.is_file():
                actual_files.add(path.relative_to(root).as_posix())
        if actual_files != set(inventory):
            return False
        return all(matches_asset(root / name, asset) for name, asset in inventory.items())
    except (OSError, ValueError, zipfile.BadZipFile):
        return False


def find_server(directory):
    candidates = list(Path(directory).rglob("llama-server.exe"))
    if len(candidates) != 1:
        raise ValueError("Expected exactly one llama-server.exe in the official Windows archive")
    return candidates[0].resolve()


def install_runtime(archive, directory):
    directory = Path(directory).absolute()
    if runtime_is_verified(directory, archive):
        print("Already verified: runtime files")
        return find_server(directory)
    inventory = archive_inventory(archive)  # Validate every name before creating files.
    if not inventory:
        raise ValueError("Runtime archive is empty")
    directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=directory.name + ".staging-", dir=directory.parent))
    backup = directory.with_name(directory.name + ".backup-" + uuid.uuid4().hex)
    moved_old = False
    try:
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                path = safe_member(member.filename)
                if member.is_dir():
                    continue
                output = staging / path.as_posix()
                output.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as incoming, output.open("wb") as target:
                    shutil.copyfileobj(incoming, target)
        find_server(staging)
        if directory.exists() or directory.is_symlink():
            if directory.is_symlink():
                raise ValueError("Refusing to replace a linked runtime directory")
            directory.rename(backup)
            moved_old = True
        try:
            staging.rename(directory)
        except OSError:
            if moved_old:
                backup.rename(directory)
                moved_old = False
            raise
        if moved_old:
            shutil.rmtree(backup)
        return find_server(directory)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def write_config(path, server, model, device, threads):
    path = Path(path)
    config = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(config, dict) or config.get("schema_version", 1) != 1:
        raise ValueError("Unsupported runtime configuration; existing configuration was kept")
    profiles = config.setdefault("profiles", {})
    if not isinstance(profiles, dict):
        raise ValueError("profiles must be a JSON object")
    config.update(schema_version=1, device=device, cpu_threads=threads)
    config.setdefault("gpu_layers", 99)
    profiles["q8"] = {"server": str(Path(server).resolve()), "model": str(Path(model).resolve())}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="runtime.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            json.dump(config, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Install pinned local translation dependencies; never starts the model.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--cpu", action="store_true", help="CPU mode (default), suitable for Windows x64 laptops")
    mode.add_argument("--gpu", action="store_true", help="Vulkan GPU mode; requires a Vulkan-capable graphics driver")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--check", action="store_true", help="Offline SHA-256 and config check; changes nothing")
    action.add_argument("--dry-run", action="store_true", help="Show exact sources and plan; no downloads or writes")
    parser.add_argument("--home", type=Path, default=None, help="Hermes home override; otherwise follows HERMES_HOME")
    parser.add_argument("--install-dir", type=Path, default=ROOT, help="Dependency folder (default: this plugin folder)")
    parser.add_argument("--threads", type=int, choices=range(1, 9), default=min(8, os.cpu_count() or 1))
    args = parser.parse_args(argv)
    home = args.home.expanduser().resolve() if args.home else hermes_home()
    directory = args.install_dir.expanduser().resolve()
    device = "gpu" if args.gpu else "cpu"
    config_path = home / "ru-translator" / "runtime.json"
    existing = {}
    if not args.dry_run and config_path.exists():
        existing = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(existing, dict) or existing.get("schema_version", 1) != 1 or not isinstance(existing.get("profiles", {}), dict):
            raise ValueError("Invalid existing runtime.json; correct it before setup")
        if not isinstance(existing.get("profiles", {}).get("q8", {}), dict):
            raise ValueError("Invalid q8 profile in runtime.json")
    # With no explicit device flag, --check follows the saved selection.
    if args.check and not args.gpu and not args.cpu and config_path.exists():
        device = existing.get("device", "cpu")
        if device not in RUNTIMES:
            raise ValueError("Unsupported configured device")
    runtime = RUNTIMES[device]
    archive = directory / ".downloads" / runtime["url"].rsplit("/", 1)[-1]
    runtime_dir = directory / "vendor" / ("llama-" + device)
    model = directory / "models" / MODEL_NAME
    print(f"Mode: {device}; CPU threads: {args.threads}")
    print("Config: " + str(config_path))
    if args.dry_run:
        print("PLAN ONLY: no files changed; no network requests.")
        for title, asset, target in (("Runtime", runtime, archive), ("Model", MODEL, model)):
            print(f"{title}: {asset['url']}\n  {asset['size']} bytes\n  SHA-256 {asset['sha256']}\n  Save: {target}")
        print("Extract runtime: " + str(runtime_dir))
        print("Write selected q8 paths and device to config. Do not start any process.")
        return 0
    if args.check:
        checks = [("Runtime ZIP", matches_asset(archive, runtime)),
                  ("Model", matches_asset(model, MODEL))]
        checks.append(("Extracted runtime", checks[0][1] and runtime_is_verified(runtime_dir, archive)))
        config_ok = False
        if config_path.is_file() and checks[-1][1]:
            q8 = existing.get("profiles", {}).get("q8", {})
            def configured_path(value):
                if not isinstance(value, str):
                    raise ValueError("Configured server/model path must be a string")
                path = Path(value).expanduser()
                return (path if path.is_absolute() else config_path.parent / path).resolve()
            config_ok = (existing.get("schema_version") == 1 and existing.get("device") == device
                         and configured_path(q8.get("server", "")) == find_server(runtime_dir)
                         and configured_path(q8.get("model", "")) == model
                         and type(existing.get("cpu_threads")) is int
                         and 1 <= existing["cpu_threads"] <= 8)
        checks.append(("Runtime config", config_ok))
        for title, passed in checks:
            print(("OK: " if passed else "MISSING OR INVALID: ") + title)
        print("Offline check only. Nothing was started or changed.")
        return 0 if all(passed for _, passed in checks) else 1
    if os.name != "nt" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise ValueError("Automatic setup supports Windows x64 only. Use manual runtime.json paths on other systems.")
    print("Explicit setup: download about 1.93 GB once; keep about 2.1 GB free.")
    print("Only official pinned runtime/model dependencies are installed. The model will remain stopped.")
    download_verified(runtime, archive)
    server = install_runtime(archive, runtime_dir)
    download_verified(MODEL, model)
    write_config(config_path, server, model, device, args.threads)
    print("Setup complete. No model was started.")
    print("Restart Hermes to load the plugin. In its translation card, choose Load when you want to translate.")
    print("Use Unload to release the model; existing translation cache is kept.")
    print("Verify offline: python scripts/setup.py --check")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print("Setup failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
