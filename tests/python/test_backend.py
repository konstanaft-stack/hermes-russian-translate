from test_support import isolated_home
"""Contract tests: real SQLite/files; only slow local inference is substituted."""
import contextlib
import gc
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class LocalizerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.addCleanup(gc.collect)
        self.mod = load('localizer_test', ROOT / 'localizer.py')
        self.mod.CACHE_DIR = Path(self.tmp.name) / 'cache'

    def rows(self):
        db = self.mod.CACHE_DIR / 'cache.db'
        if not db.exists():
            return []
        with contextlib.closing(sqlite3.connect(db)) as conn:
            return conn.execute('SELECT src,out FROM translations').fetchall()

    def test_model_and_unknown_engines_are_rejected_without_cloud_call(self):
        for engine in ('model', 'unknown'):
            with self.subTest(engine=engine), patch.object(self.mod, '_translate_model', create=True, side_effect=AssertionError('cloud invoked')):
                with self.assertRaisesRegex(ValueError, 'local'):
                    self.mod.translate(['hello'], engine=engine)

    def test_auto_missing_local_engine_fails_locally(self):
        runtime = types.SimpleNamespace(translate=lambda texts: (_ for _ in ()).throw(RuntimeError('HY-MT2 не загружен')), translation_scope=lambda: contextlib.nullcontext('hymt2-q8-a0c709d9-mechanical-v3'))
        with patch.object(self.mod, '_runtime', return_value=runtime), patch.object(self.mod, '_translate_model', create=True, side_effect=AssertionError('cloud invoked')):
            with self.assertRaisesRegex(RuntimeError, 'HY-MT2'):
                self.mod.translate(['hello'], engine='auto')

    def test_invalid_inputs_rejected_before_cache_or_worker(self):
        for texts, lang in ((['a'] * 9, 'ru'), (['x' * 24001], 'ru'), (['a'], 'de'), (['a', 2], 'ru'), ('abc', 'ru'), ([], 'ru')):
            with self.subTest(texts=repr(texts)[:40], lang=lang):
                with self.assertRaises(ValueError):
                    self.mod.translate(texts, lang=lang, engine='local')
        self.assertFalse(self.mod.CACHE_DIR.exists())

    def test_partial_empty_or_malformed_outputs_never_enter_cache(self):
        for output in (['один'], ['один', ''], ['один', 2], {'0': 'один'}, ['один', 'два', 'три']):
            with self.subTest(output=output), patch.object(self.mod, '_translate_local', return_value=output):
                with self.assertRaisesRegex(RuntimeError, 'результат'):
                    self.mod.translate(['one', 'two'], engine='local')
            self.assertEqual(self.rows(), [])

    def test_indices_duplicates_whitespace_and_cache_replay(self):
        with patch.object(self.mod, '_translate_local', return_value=['один', 'два']):
            first = self.mod.translate(['one', ' ', 'two', 'one'], engine='local')
        self.assertEqual(first['texts'], ['один', ' ', 'два', 'один'])
        with patch.object(self.mod, '_translate_local', side_effect=AssertionError('cache miss')):
            second = self.mod.translate(['two', 'one', ' '], engine='local')
        self.assertEqual(second['texts'], ['два', 'один', ' '])
        self.assertEqual(len(self.rows()), 2)

    def test_db_closed_on_translate_failure_and_status(self):
        connections = []
        original = self.mod._db
        def capture():
            conn = original()
            connections.append(conn)
            return conn
        with patch.object(self.mod, '_db', side_effect=capture), patch.object(self.mod, '_translate_local', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):
                self.mod.translate(['one'], engine='local')
            with patch.object(self.mod, '_runtime', return_value=types.SimpleNamespace(status=lambda: {'available':True,'loaded':False})):
                self.mod.status()
        for conn in connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                conn.execute('SELECT 1')

    def test_heavy_work_serialized_across_requests(self):
        active = 0
        overlap = []
        gate = threading.Barrier(2)
        errors = []
        def worker(texts):
            nonlocal active
            active += 1
            overlap.append(active)
            time.sleep(.05)
            active -= 1
            return ['перевод']
        def request(text):
            try:
                gate.wait()
                self.mod.translate([text], engine='local')
            except Exception as exc:
                errors.append(exc)
        with patch.object(self.mod, '_translate_local', side_effect=worker):
            threads = [threading.Thread(target=request, args=(t,)) for t in ('one', 'two')]
            for t in threads: t.start()
            for t in threads: t.join()
        self.assertEqual(errors, [])
        self.assertEqual(max(overlap), 1)

    def test_catalog_apply_is_disabled_without_touching_files(self):
        catalog = Path(self.tmp.name) / 'catalog.json'
        overlay = Path(self.tmp.name) / 'ru.json'
        catalog.write_text('{"entries":[{"name":"x","description":"one"}]}', encoding='utf-8')
        overlay.write_text('{"x":{"description":"один"}}', encoding='utf-8')
        self.mod.CATALOG, self.mod.CATALOG_RU = catalog, overlay
        self.mod.CATALOG_EN = Path(self.tmp.name) / 'backup.json'
        before = catalog.read_bytes()
        result = self.mod.apply_catalog()
        self.assertFalse(result['ok'])
        self.assertIn('error', result)
        self.assertEqual(catalog.read_bytes(), before)
        self.assertFalse(self.mod.CATALOG_EN.exists())


class APITests(unittest.TestCase):
    def setUp(self):
        self.api = load('plugin_api_test', ROOT / 'dashboard' / 'plugin_api.py')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.addCleanup(gc.collect)
        self.mod = load('api_localizer_test', ROOT / 'localizer.py')
        self.mod.CACHE_DIR = Path(self.tmp.name) / 'cache'

    def test_http_preserves_blank_element_and_index(self):
        body = self.api.TranslateBody(texts=['one', ' ', 'two'])
        with patch.object(self.api, '_localizer', return_value=self.mod), patch.object(self.mod, '_translate_local', return_value=['один', 'два']):
            result = self.api.translate(body)
        self.assertEqual(result['texts'], ['один', ' ', 'два'])

    def test_http_invalid_batch_is_client_error(self):
        with patch.object(self.api, '_localizer', return_value=self.mod):
            with self.assertRaises(self.api.HTTPException) as caught:
                self.api.translate(self.api.TranslateBody(texts=['a'] * 9))
        self.assertEqual(caught.exception.status_code, 400)

    def test_http_unavailable_local_engine_is_explicit_service_error(self):
        with patch.object(self.api, '_localizer', return_value=self.mod), patch.object(self.mod, '_translate_local', side_effect=RuntimeError('HY-MT2 не загружен')):
            with self.assertRaises(self.api.HTTPException) as caught:
                self.api.translate(self.api.TranslateBody(texts=['one']))
        self.assertEqual(caught.exception.status_code, 503)

    def test_http_catalog_mutation_is_disabled(self):
        with patch.object(self.api, '_localizer', side_effect=AssertionError('must not load engine')):
            with self.assertRaises(self.api.HTTPException) as caught:
                self.api.catalog_apply()
        self.assertEqual(caught.exception.status_code, 410)


class ToolTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('translator_test_package', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
        self.mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.mod
        self.addCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(self.mod)

    def test_tool_does_not_drop_blank_positions(self):
        with patch.object(self.mod.localizer, 'translate', return_value={'texts': ['один', ' ', 'два']}) as translate:
            result = json.loads(self.mod._translate({'texts': ['one', ' ', 'two']}))
        self.assertEqual(result['texts'], ['один', ' ', 'два'])
        self.assertEqual(translate.call_args.args[0], ['one', ' ', 'two'])

    def test_tool_invalid_types_are_errors_not_coerced_strings(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'cache'
            with patch.object(self.mod.localizer, 'CACHE_DIR', cache), self.assertLogs(self.mod.log, level='WARNING'):
                result = json.loads(self.mod._translate({'texts': [42]}))
            self.assertIn('error', result)
            self.assertFalse(cache.exists())

    def test_tool_schema_promises_only_local_russian(self):
        schema = self.mod._schema_translate()['parameters']['properties']
        self.assertEqual(schema['engine']['enum'], ['local'])
        self.assertEqual(schema['lang']['enum'], ['ru'])


if __name__ == '__main__':
    unittest.main()
