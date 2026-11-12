from test_support import isolated_home
"""Owned-runtime contract tests: never launch a model or contact the network."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load():
    spec = importlib.util.spec_from_file_location('hymt_test', ROOT / 'hymt_runtime.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.manager = self.mod.RuntimeManager(Path(self.tmp.name))

    def test_status_and_translate_never_autostart(self):
        with patch.object(self.mod.subprocess, 'Popen', side_effect=AssertionError('unrequested start')):
            self.assertFalse(self.manager.status()['loaded'])
            with self.assertRaisesRegex(RuntimeError, 'загру'):
                self.manager.translate(['Install plugins.'])

    def test_compact_cannot_start_until_verified(self):
        with self.assertRaises(ValueError):
            self.manager.start('compact')

    def test_child_environment_excludes_credentials_and_python_injection(self):
        with patch.dict(os.environ, {'SECRET_TEST_API_KEY':'do-not-pass','PYTHONPATH':'bad','LLAMA_ARG_HOST':'0.0.0.0','USERPROFILE':'test-user'}, clear=True):
            env = self.manager._child_env()
        self.assertEqual(env, {'USERPROFILE':'test-user'})

    def test_unload_refuses_pid_reuse_and_never_terminates_it(self):
        receipt = {'pid': 42, 'created': 100, 'exe': 'server.exe', 'argv': ['server.exe', '-m', 'owned.gguf']}
        self.manager._write_receipt(receipt)
        with patch.object(self.manager, '_process_info', return_value={'pid':42,'created':101,'exe':'server.exe','argv':receipt['argv']}), patch.object(self.manager, '_terminate_owned', side_effect=AssertionError('unowned process killed')):
            with self.assertRaisesRegex(RuntimeError, 'принадлеж'):
                self.manager.stop()

    def test_unload_refuses_other_model_or_commandline(self):
        receipt = {'pid':42,'created':100,'exe':'server.exe','argv':['server.exe','-m','owned.gguf']}
        self.manager._write_receipt(receipt)
        with patch.object(self.manager, '_process_info', return_value={'pid':42,'created':100,'exe':'server.exe','argv':['server.exe','-m','other.gguf']}), patch.object(self.manager, '_terminate_owned', side_effect=AssertionError('unowned process killed')):
            with self.assertRaisesRegex(RuntimeError, 'принадлеж'):
                self.manager.stop()

    def test_unload_only_exact_receipt_process(self):
        receipt = {'pid':42,'created':100,'exe':'server.exe','argv':['server.exe','-m','owned.gguf']}
        self.manager._write_receipt(receipt)
        calls = []
        with patch.object(self.manager, '_process_info', return_value=receipt), patch.object(self.manager, '_terminate_owned', side_effect=lambda r:calls.append(r['pid'])):
            result = self.manager.stop()
        self.assertEqual(calls, [42])
        self.assertFalse(result['loaded'])
        self.assertFalse(self.manager.receipt_path.exists())

    def test_start_refuses_occupied_port_before_spawning(self):
        with patch.object(self.manager, '_port_free', return_value=False), patch.object(self.mod.subprocess, 'Popen', side_effect=AssertionError('spawned on occupied port')):
            with self.assertRaisesRegex(RuntimeError, 'порт'):
                self.manager.start('q8')

    def test_start_uses_only_approved_cpu_args_and_writes_ownership(self):
        info = {'pid':42,'created':100,'exe':str(self.mod.SERVER),'argv':['approved-server','approved-model']}
        process = types.SimpleNamespace(pid=42,poll=lambda:None,terminate=lambda:None,wait=lambda **kwargs:None)
        with patch.object(self.manager,'status',side_effect=[{'loaded':False},{'loaded':True}]), patch.object(self.manager,'_port_free',return_value=True), patch.object(self.manager,'_verify_model'), patch.object(self.manager,'_process_info',return_value=info), patch.object(self.mod.subprocess,'Popen',return_value=process) as launch:
            self.assertTrue(self.manager.start()['loaded'])
        argv = launch.call_args.args[0]
        for flag,value in (('--host','127.0.0.1'),('--port','18961'),('--threads',str(min(8,os.cpu_count() or 1))),('--n-gpu-layers','0'),('--ctx-size','8192'),('--parallel','1'),('--batch-size','512'),('--ubatch-size','128')):
            self.assertEqual(argv[argv.index(flag)+1],value)
        self.assertNotIn('--api-key',argv)
        receipt = self.manager._receipt()
        self.assertEqual(receipt['created'],100)
        self.assertEqual(receipt['model_sha256'],'5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4')

    def test_receipt_write_failure_cannot_leak_owned_started_process(self):
        terminated = []
        process = types.SimpleNamespace(pid=42,poll=lambda:None,terminate=lambda:terminated.append(42),wait=lambda **kwargs:None)
        info = {'pid':42,'created':100,'exe':str(self.mod.SERVER),'argv':['server']}
        with patch.object(self.manager,'status',return_value={'loaded':False}), patch.object(self.manager,'_port_free',return_value=True), patch.object(self.manager,'_verify_model'), patch.object(self.manager,'_process_info',return_value=info), patch.object(self.manager,'_write_receipt',side_effect=OSError('disk failure')), patch.object(self.mod.subprocess,'Popen',return_value=process):
            with self.assertRaises(OSError):
                self.manager.start()
        self.assertEqual(terminated,[42])





    def test_start_failure_keeps_stderr_diagnostics_without_token_contents(self):
        info = {'pid':42,'created':100,'exe':str(self.mod.SERVER),'argv':['server']}
        process = types.SimpleNamespace(pid=42,poll=lambda:1,terminate=lambda:None,wait=lambda **kwargs:None)
        def spawn(*args,**kwargs):
            stderr = kwargs['stderr']
            self.assertNotEqual(stderr,self.mod.subprocess.DEVNULL)
            stderr.write(b'GGUF model load failed: diagnostic fixture\n')
            stderr.flush()
            return process
        with patch.object(self.manager,'status',return_value={'loaded':False}), patch.object(self.manager,'_port_free',return_value=True), patch.object(self.manager,'_verify_model'), patch.object(self.manager,'_process_info',return_value=info), patch.object(self.manager,'_terminate_owned'), patch.object(self.mod.subprocess,'Popen',side_effect=spawn):
            with self.assertRaises(RuntimeError):
                self.manager.start()
        log = self.manager.state_dir/'server.stderr.log'
        self.assertIn('GGUF model load failed',log.read_text(encoding='utf-8'))
        self.assertFalse(self.manager.token_path.exists())

    def test_http_rejects_external_or_redirect_paths(self):
        for path in ('https://example.org/x','//example.org/x','/other','/v1/chat/completions?url=external'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.manager._request(path)


class CacheAndRouteTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('hymt_localizer_test', ROOT / 'localizer.py')
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.mod.CACHE_DIR = Path(self.tmp.name) / 'cache'

    def test_new_engine_never_replays_old_argos_cache(self):
        conn = self.mod._db()
        conn.execute('INSERT INTO translations VALUES (?,?,?,?,?,?)',(self.mod._key('hello','ru','local'),'hello','ru','local','старый Argos',0))
        conn.commit()
        conn.close()
        with patch.object(self.mod, '_translate_local', return_value=['новый HY-MT2']):
            result = self.mod.translate(['hello'])
        self.assertEqual(result['texts'], ['новый HY-MT2'])
        self.assertEqual(result.get('cache_epoch'), 'hymt2-q8-a0c709d9-mechanical-v3')

    def test_cache_lookup_does_not_wait_for_generation_lock_or_infer(self):
        lookup = getattr(self.mod,'cache_lookup',None)
        self.assertTrue(callable(lookup), 'Fast cache-only lookup is missing')
        with patch.object(self.mod,'_translate_local',return_value=['привет']):
            self.mod.translate(['hello'])
        self.mod._WORK_LOCK.acquire()
        try:
            with patch.object(self.mod,'_translate_local',side_effect=AssertionError('lookup ran inference')):
                result = lookup(['hello','missing',' '])
        finally:
            self.mod._WORK_LOCK.release()
        self.assertEqual(result['texts'],['привет',None,' '])
        self.assertEqual(result['missed'],1)

    def test_engine_and_lookup_routes_exist_and_keep_local_contract(self):
        spec = importlib.util.spec_from_file_location('hymt_api_test', ROOT / 'dashboard' / 'plugin_api.py')
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        paths = {route.path for route in api.router.routes}
        self.assertTrue({'/engine/start','/engine/stop','/cache/lookup'} <= paths)


if __name__ == '__main__':
    unittest.main()
