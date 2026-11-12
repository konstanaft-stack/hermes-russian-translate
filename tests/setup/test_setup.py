"""Offline installation tests; no runtime or model is executed or downloaded."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "setup.py"


def load_setup():
    spec = importlib.util.spec_from_file_location("translator_setup", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), "The explicit, offline-capable setup entry point is missing")
        self.setup = load_setup()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def asset(self, data):
        return {"url": "https://github.com/ggml-org/llama.cpp/releases/download/fixture/runtime.zip",
                "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}

    def test_verified_file_is_reused_without_network(self):
        data = b"fixture model"
        target = self.root / "model.gguf"
        target.write_bytes(data)
        with patch.object(self.setup.urllib.request, "urlopen", side_effect=AssertionError("network")):
            self.assertFalse(self.setup.download_verified(self.asset(data), target))
        self.assertEqual(target.read_bytes(), data)

    def test_hash_failure_does_not_replace_existing_file(self):
        target = self.root / "model.gguf"
        target.write_bytes(b"existing")
        with patch.object(self.setup.urllib.request, "urlopen", return_value=io.BytesIO(b"tampered")):
            with self.assertRaises(ValueError):
                self.setup.download_verified(self.asset(b"expected"), target)
        self.assertEqual(target.read_bytes(), b"existing")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_verified_download_is_atomic_and_then_reused(self):
        data = b"small fixture"
        target = self.root / "sub" / "model.gguf"
        with patch.object(self.setup.urllib.request, "urlopen", return_value=io.BytesIO(data)):
            self.assertTrue(self.setup.download_verified(self.asset(data), target))
        self.assertEqual(target.read_bytes(), data)
        self.assertTrue(self.setup.matches_asset(target, self.asset(data)))

    def make_zip(self, entries):
        archive = self.root / "runtime.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return archive

    def test_archive_traversal_cannot_write_outside_runtime(self):
        for name in ("../escaped.exe", "..\\escaped.exe", "C:/escaped.exe", "/escaped.exe"):
            archive = self.make_zip({name: b"bad", "llama-server.exe": b"server"})
            with self.assertRaises(ValueError):
                self.setup.install_runtime(archive, self.root / "runtime")
            self.assertFalse((self.root / "escaped.exe").exists())
            self.assertFalse((self.root / "runtime").exists())

    def test_runtime_file_modification_is_detected(self):
        archive = self.make_zip({"bin/llama-server.exe": b"server", "bin/ggml.dll": b"dll"})
        target = self.root / "runtime"
        server = self.setup.install_runtime(archive, target)
        self.assertEqual(server.read_bytes(), b"server")
        self.assertTrue(self.setup.runtime_is_verified(target, archive))
        server.write_bytes(b"modified")
        self.assertFalse(self.setup.runtime_is_verified(target, archive))

    def test_cpu_install_preserves_other_profile_and_settings(self):
        config = self.root / "home" / "ru-translator" / "runtime.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"schema_version": 1, "gpu_layers": 27,
                                     "profiles": {"stream": {"server": "custom", "model": "custom.gguf"}}}))
        self.setup.write_config(config, self.root / "server.exe", self.root / "model.gguf", "cpu", 3)
        result = json.loads(config.read_text(encoding="utf-8"))
        self.assertEqual(result["profiles"]["stream"], {"server": "custom", "model": "custom.gguf"})
        self.assertEqual(result["gpu_layers"], 27)
        self.assertEqual(result["device"], "cpu")
        self.assertEqual(result["cpu_threads"], 3)
        self.assertEqual(result["profiles"]["q8"]["model"], str(self.root / "model.gguf"))

    def test_dry_run_does_not_create_home_or_install_directories(self):
        home = self.root / "missing-home"
        install = self.root / "missing-plugin"
        result = subprocess.run([sys.executable, str(SCRIPT), "--dry-run", "--home", str(home),
                                 "--install-dir", str(install)], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("cpu", result.stdout.lower())
        self.assertIn("1908528192", result.stdout)
        self.assertFalse(home.exists())
        self.assertFalse(install.exists())

    def test_check_missing_install_is_read_only_and_nonzero(self):
        home = self.root / "missing-home"
        install = self.root / "missing-plugin"
        result = subprocess.run([sys.executable, str(SCRIPT), "--check", "--home", str(home),
                                 "--install-dir", str(install)], capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(home.exists())
        self.assertFalse(install.exists())

    @unittest.skipUnless(sys.platform == "win32", "Automatic dependency installation targets Windows x64")
    def test_complete_gpu_setup_and_recheck_use_only_verified_fixtures(self):
        archive = self.make_zip({"llama-server.exe": b"not executable fixture", "ggml.dll": b"dll fixture"})
        runtime_data = archive.read_bytes()
        model_data = b"model fixture"
        runtime = self.asset(runtime_data)
        model = self.asset(model_data)
        model["url"] = "https://huggingface.co/tencent/fixture/resolve/pin/model.gguf"
        def fixture_response(request, **kwargs):
            return io.BytesIO(model_data if request.full_url.startswith("https://huggingface.co/") else runtime_data)
        install = self.root / "plugin"
        home = self.root / "home"
        args = ["--gpu", "--install-dir", str(install), "--home", str(home), "--threads", "2"]
        with patch.dict(self.setup.RUNTIMES, {"gpu": runtime}), patch.object(self.setup, "MODEL", model):
            with patch.object(self.setup.urllib.request, "urlopen", side_effect=fixture_response):
                self.assertEqual(self.setup.main(args), 0)
            with patch.object(self.setup.urllib.request, "urlopen", side_effect=AssertionError("repeat download")):
                self.assertEqual(self.setup.main(args), 0)
                self.assertEqual(self.setup.main(["--check", "--install-dir", str(install), "--home", str(home)]), 0)
        config = json.loads((home / "ru-translator" / "runtime.json").read_text(encoding="utf-8"))
        self.assertEqual(config["device"], "gpu")
        self.assertEqual(config["cpu_threads"], 2)
        self.assertEqual(Path(config["profiles"]["q8"]["server"]).read_bytes(), b"not executable fixture")

    def test_check_malformed_configuration_reports_error_without_traceback(self):
        home = self.root / "home"
        config = home / "ru-translator" / "runtime.json"
        config.parent.mkdir(parents=True)
        config.write_text("[]", encoding="utf-8")
        result = subprocess.run([sys.executable, str(SCRIPT), "--check", "--home", str(home),
                                 "--install-dir", str(self.root / "plugin")],
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(config.read_text(encoding="utf-8"), "[]")


if __name__ == "__main__":
    unittest.main()
