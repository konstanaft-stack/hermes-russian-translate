from test_support import isolated_home
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_hymt import load


def reply(text):
    return {'choices':[{'message':{'content':text},'finish_reason':'stop'}]}


class MechanicalTranslationTests(unittest.TestCase):
    def setUp(self):
        self.mod=load()
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        self.manager=self.mod.RuntimeManager(Path(self.tmp.name))
        loaded=patch.object(self.manager,'_require_loaded')
        loaded.start()
        self.addCleanup(loaded.stop)

    def test_configuration_literals_copied_and_prose_processed_once(self):
        card={'source': 'Read file:// and set formation.mode: off. Keep embeddings_enabled: true in HERMES_HOME/.env. Configure ENTROPICMEM_EMBEDDINGS_BASE_URL before enabling memory. Read file:// again.'}
        seen=[]
        def request(path,payload,timeout=150):
            prose=payload['messages'][0]['content'].split('\n\n',1)[1]
            self.assertEqual(self.mod._critical_spans(prose),[],'Protected literals were fed to the model')
            self.assertLessEqual(len(prose),3000)
            seen.append(prose)
            return reply('⟦RU⟧'+prose)
        with patch.object(self.manager,'_request',side_effect=request):
            output=self.manager.translate([card['source']])[0]
        self.assertEqual(output.replace('⟦RU⟧',''),card['source'])
        self.assertEqual(len(seen),len(set(seen)))
        for token in ('file://','formation.mode: off','embeddings_enabled: true','HERMES_HOME/.env','ENTROPICMEM_EMBEDDINGS_BASE_URL'):
            self.assertIn(token,output)

    def test_repeated_prose_is_inferred_once_across_batch(self):
        with patch.object(self.manager,'_request',return_value=reply('Читайте')) as request:
            output=self.manager.translate(['Read file://.','Read `code`.',' '])
        self.assertEqual(output,['Читайте file://.','Читайте `code`.',' '])
        self.assertEqual(request.call_count,1)

    def test_global_deadline_refuses_later_prose_without_partial_result(self):
        clock=iter([0,0,151])
        with patch.object(self.mod.time,'monotonic',side_effect=lambda:next(clock,151)),patch.object(self.manager,'_request',return_value=reply('Читайте')) as request:
            with self.assertRaisesRegex(RuntimeError,'150'):
                self.manager.translate(['Read file:// and configure formation.mode: off.'])
        self.assertEqual(request.call_count,1)

    def test_empty_prose_result_is_rejected(self):
        with patch.object(self.manager,'_request',return_value=reply('')):
            with self.assertRaises(RuntimeError):
                self.manager.translate(['Read file://.'])

    def test_punctuation_whitespace_and_technical_only_need_no_inference(self):
        with patch.object(self.manager,'_request',return_value=reply('Читайте')) as request:
            output=self.manager.translate(['  (Read) `x`!\n','formation.mode: off','\t '])
        self.assertEqual(output,['  (Читайте) `x`!\n','formation.mode: off','\t '])
        self.assertEqual(request.call_count,1)
