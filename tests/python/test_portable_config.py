"""Portable configuration contracts; never launch/download models."""
import json
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from test_hymt import load


class PortableConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # Windows runners may expose the temp directory through an 8.3 alias.
        self.home = Path(self.tmp.name).resolve()
        env = patch.dict(os.environ, {'HERMES_HOME': str(self.home)})
        env.start()
        self.addCleanup(env.stop)
        self.mod = load()

    def config(self, value):
        path = self.home / 'ru-translator' / 'runtime.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def manager(self):
        return self.mod.RuntimeManager(self.home / 'cache' / 'ru-translator' / 'hymt-runtime')

    def test_clean_home_uses_cpu_without_optional_profiles_or_start(self):
        with patch.object(self.mod.subprocess, 'Popen', side_effect=AssertionError('auto load')):
            manager = self.manager()
            status = manager.status()
            args = manager._argv('q8')
        self.assertEqual(status['device'], 'cpu')
        self.assertEqual(status['enabled_variants'], ['q8'])
        self.assertFalse(status['loaded'])
        self.assertEqual(args[args.index('--n-gpu-layers') + 1], '0')
        self.assertLessEqual(int(args[args.index('--threads') + 1]), 8)
        self.assertNotIn('--device', args)
        self.assertEqual(Path(args[0]).parent.parent, Path(self.mod.__file__).parent / 'vendor')
        self.assertFalse((self.home / 'ru-translator' / 'runtime.json').exists())

    def test_relative_paths_and_explicit_gpu_keep_same_q8_cache(self):
        cpu_epoch = self.manager().cache_epoch()
        self.config({'schema_version': 1, 'device': 'gpu', 'gpu_device': 'Vulkan0',
                     'profiles': {'q8': {'server': 'runtime/server.exe', 'model': 'models/q8.gguf'}}})
        manager = self.manager()
        args = manager._argv('q8')
        self.assertEqual(Path(args[0]), self.home / 'ru-translator/runtime/server.exe')
        self.assertEqual(Path(args[args.index('--model') + 1]), self.home / 'ru-translator/models/q8.gguf')
        self.assertEqual(args[args.index('--n-gpu-layers') + 1], '99')
        self.assertIn('Vulkan0', args)
        self.assertEqual(manager.cache_epoch(), cpu_epoch)

    def test_invalid_configuration_refuses_before_runtime_actions(self):
        for value in ({'device': 'remote'}, {'schema_version': 2}, {'cpu_threads': 0},
                      {'profiles': {'q8': {'sha256': 'override'}}}, {'gpu_layers': -1},
                      {'profiles': {'unknown': {}}}, {'profiles': {'q8': {'model': 'https://host/model'}}}):
            with self.subTest(value=value):
                self.config(value)
                with patch.object(self.mod.subprocess, 'Popen', side_effect=AssertionError('started')):
                    with self.assertRaises(ValueError):
                        self.manager().status()

    def test_cpu_thread_request_is_capped_and_optional_profile_is_explicit(self):
        self.config({'device': 'cpu', 'cpu_threads': 64, 'profiles': {'stq':
                     {'server': 'stq/server.exe', 'model': 'stq/model.gguf'}}})
        manager = self.manager()
        args = manager._argv('stq')
        self.assertEqual(args[args.index('--threads') + 1], '8')
        self.assertEqual(manager.status()['enabled_variants'], ['q8', 'stq'])
        with self.assertRaises(ValueError):
            manager.start('stream')

    def test_start_launches_the_exact_profile_that_was_verified(self):
        self.config({'profiles': {'q8': {'server': 'approved/server.exe', 'model': 'approved/model.gguf'}}})
        manager = self.manager()
        process = types.SimpleNamespace(pid=42, poll=lambda: None, terminate=lambda: None, wait=lambda **kw: None)
        info = {'pid': 42, 'created': 1, 'exe': 'approved', 'argv': ['approved']}
        def verify(*args, **kwargs):
            self.config({'profiles': {'q8': {'server': 'other/server.exe', 'model': 'unverified/model.gguf'}}})
        with patch.object(manager, 'status', side_effect=[{'loaded': False}, {'loaded': True}]), \
             patch.object(manager, '_port_free', return_value=True), \
             patch.object(manager, '_verify_model', side_effect=verify), \
             patch.object(manager, '_process_info', return_value=info), \
             patch.object(self.mod.subprocess, 'Popen', return_value=process) as launch:
            manager.start()
        args = launch.call_args.args[0]
        self.assertEqual(Path(args[0]), self.home / 'ru-translator/approved/server.exe')
        self.assertEqual(Path(args[args.index('--model') + 1]), self.home / 'ru-translator/approved/model.gguf')

    def test_cache_and_runtime_expand_the_same_explicit_home(self):
        with patch.dict(os.environ, {'HERMES_HOME': '~/hermes-test', 'USERPROFILE': str(self.home), 'HOME': str(self.home)}):
            spec = importlib.util.spec_from_file_location('portable_localizer', Path(self.mod.__file__).parent / 'localizer.py')
            localizer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(localizer)
            self.assertEqual(localizer.CACHE_DIR, self.home / 'hermes-test/cache/ru-translator')
            self.assertEqual(self.mod.hermes_home(), self.home / 'hermes-test')

    def test_unload_remains_available_when_configuration_becomes_invalid(self):
        manager = self.manager()
        receipt = {'pid': 42, 'created': 1, 'exe': 'owned', 'argv': ['owned'], 'variant': 'q8'}
        manager._write_receipt(receipt)
        manager.token_path.write_text('test-token', encoding='ascii')
        self.config({'device': 'invalid'})
        with patch.object(manager, '_process_info', return_value=receipt), \
             patch.object(manager, '_terminate_owned') as terminate:
            try:
                result = manager.stop()
            except ValueError:
                self.fail('Invalid configuration blocked owned-process unload cleanup')
        self.assertFalse(result['loaded'])
        self.assertIn('configuration_error', result)
        self.assertEqual(terminate.call_args.args[0], receipt)
        self.assertFalse(manager.receipt_path.exists())
        self.assertFalse(manager.token_path.exists())


if __name__ == '__main__':
    unittest.main()

