from test_support import isolated_home
import json
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_hymt import load


def reply(text, finish='stop'):
    return {'choices':[{'message':{'content':text},'finish_reason':finish}]}


class PlainTranslationTests(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.manager = self.mod.RuntimeManager(Path(self.tmp.name))
        self.loaded = patch.object(self.manager,'_require_loaded')
        self.loaded.start()
        self.addCleanup(self.loaded.stop)



    def test_adjacent_literals_and_config_values_are_extracted_whole(self):
        spans = getattr(self.mod,'_critical_spans',None)
        self.assertTrue(callable(spans))
        source='HERMES_HOME/entropicmem/; file:// C:\\Tools\\x.py `a``b` formation.mode: off embeddings_enabled: true ENTROPICMEM_LLM_BASE_URL'
        tokens=[source[a:b] for a,b in spans(source)]
        for literal in ('HERMES_HOME/entropicmem/','file://','C:\\Tools\\x.py','formation.mode: off','embeddings_enabled: true','ENTROPICMEM_LLM_BASE_URL'):
            self.assertIn(literal,tokens)
        self.assertNotIn('e://',tokens)

    def test_off_in_ordinary_prose_translates_but_config_value_is_literal(self):
        source='Embeddings are off by default and work offline; formation.mode: off.'
        tokens=[source[a:b] for a,b in self.mod._critical_spans(source)]
        self.assertEqual(tokens,['formation.mode: off'])

    def test_author_prompt_is_exact_and_plain(self):
        with patch.object(self.manager,'_request',return_value=reply('Обычный перевод.')) as request:
            self.manager.translate(['Plain text.'])
        self.assertEqual(request.call_args.args[1]['messages'][0]['content'], 'Translate the following text into Russian. Note that you should only output the translated result without any additional explanation. Preserve all URLs, code in backticks and file paths exactly as written:\n\nPlain text')


    def test_long_paragraphs_roundtrip_all_content_and_values(self):
        source=('A full sentence with detailed descriptive context and complete instructions. ' * 200)+' Final formation.mode: off and file:// instructions.'
        requests=[]
        def request(path,payload,timeout=150):
            original=payload['messages'][0]['content'].split('\n\n',1)[1]
            requests.append(original)
            return reply(original)
        with patch.object(self.manager,'_request',side_effect=request):
            result=self.manager.translate([source,' '])
        self.assertEqual(result,[source,' '])
        self.assertGreater(len(requests),1)
        self.assertTrue(all(len(text)<=3000 for text in requests))

    def test_incomplete_or_empty_response_never_returned(self):
        for output in (reply('', 'stop'),reply('перевод','length')):
            with self.subTest(output=output),patch.object(self.manager,'_request',return_value=output):
                with self.assertRaises(RuntimeError):
                    self.manager.translate(['A complete paragraph.'])

    def test_unknown_marker_is_rejected_without_open_ended_retry(self):
        with patch.object(self.manager,'_request',return_value=reply('Перевод __L99__')) as request:
            with self.assertRaises(RuntimeError):
                self.manager.translate(['A complete paragraph.'])
        self.assertEqual(request.call_count,1)

    def test_later_failed_translation_cannot_commit_first_result(self):
        import importlib.util
        import sqlite3
        spec=importlib.util.spec_from_file_location('plain_cache_test',Path(__file__).resolve().parents[2]/'localizer.py')
        localizer=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(localizer)
        localizer.CACHE_DIR=Path(self.tmp.name)/'translation-cache'
        with patch.object(localizer,'_runtime',return_value=self.manager),patch.object(self.manager,'_request',side_effect=[reply('Первый перевод.'),reply('')]):
            with self.assertRaises(RuntimeError):
                localizer.translate(['First text.','Memory formation.mode is off.'])
        with closing(sqlite3.connect(localizer.CACHE_DIR/'cache.db')) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM translations').fetchone()[0],0)
