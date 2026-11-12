import json
from test_support import isolated_home
from contextlib import nullcontext
import importlib.util
from pathlib import Path
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch
from test_hymt import load


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.mod=load()
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        isolated_home(self, self.tmp.name)
        config = Path(self.tmp.name)/'ru-translator/runtime.json'
        config.parent.mkdir()
        config.write_text(json.dumps({'device':'gpu','gpu_device':'Vulkan0','cpu_threads':8,'profiles':{
            'stq':{'server':'runtime/stq/server','model':'models/stq.gguf'},
            'stream':{'server':'runtime/gpu/server','model':'models/stream.gguf'}}}),encoding='utf-8')
        self.manager=self.mod.RuntimeManager(Path(self.tmp.name))

    def test_three_profiles_available_without_loading(self):
        status=self.manager.status()
        self.assertEqual(status['enabled_variants'],['q8','stq','stream'])
        self.assertEqual({p['id']:p['device'] for p in status['profiles']},{'q8':'gpu','stq':'cpu','stream':'gpu'})
        self.assertFalse(status['loaded'])

    def test_stop_retains_selected_cpu_profile_across_new_manager(self):
        select=getattr(self.manager,'_select_profile',None)
        self.assertTrue(callable(select))
        select('stq')
        self.manager.stop()
        status=self.mod.RuntimeManager(Path(self.tmp.name)).status()
        self.assertEqual(status['variant'],'stq')
        self.assertEqual(status['device'],'cpu')
        self.assertEqual(status['cache_epoch'],'stq-compat-f1e0ad-v1')

    def test_unknown_profile_refuses_without_stopping_or_persisting(self):
        with patch.object(self.manager,'stop',side_effect=AssertionError('stopped before validation')):
            with self.assertRaises(ValueError):self.manager.start('unknown')
        self.assertEqual(self.manager.status()['variant'],'q8')

    def test_switch_refuses_unowned_process_without_stopping_it(self):
        self.manager._write_receipt({'pid':42,'created':1,'exe':'old','argv':['old'],'variant':'q8'})
        with patch.object(self.manager,'_process_info',return_value={'pid':42,'created':2,'exe':'other','argv':['other']}),patch.object(self.manager,'_terminate_owned',side_effect=AssertionError('killed unowned')):
            with self.assertRaisesRegex(RuntimeError,'принадлеж'):self.manager.start('stq')

    def test_switch_waits_for_active_generation_before_stopping_owned(self):
        shared=getattr(self.manager,'translation_scope',None)
        self.assertTrue(callable(shared))
        stopped=threading.Event()
        receipt={'pid':42,'created':1,'exe':'old','argv':['old'],'variant':'q8'}
        self.manager._write_receipt(receipt)
        with patch.object(self.manager,'_process_info',return_value=receipt),patch.object(self.manager,'_terminate_owned',side_effect=lambda _:stopped.set()):
            with shared():
                thread=threading.Thread(target=self.manager.stop)
                thread.start()
                self.assertFalse(stopped.wait(.03))
            thread.join(2)
        self.assertTrue(stopped.is_set())

    def test_profile_args_are_cpu_and_gpu_specific(self):
        argv=getattr(self.manager,'_argv',None)
        self.assertTrue(callable(argv))
        cpu=argv('stq')
        self.assertEqual(cpu[cpu.index('--n-gpu-layers')+1],'0')
        self.assertNotIn('--device',cpu)
        self.assertEqual(cpu[cpu.index('--threads')+1],'8')
        self.assertEqual(cpu[cpu.index('--ctx-size')+1],'4096')
        stream=argv('stream')
        self.assertIn('hermes-streamrevise',stream)
        self.assertIn('Vulkan0',stream)

    def test_switch_stops_only_owned_old_before_one_new_server(self):
        old={'pid':42,'created':1,'exe':'old','argv':['old'],'variant':'q8'}
        new={'pid':43,'created':2,'exe':'new','argv':['new']}
        self.manager._write_receipt(old)
        process=types.SimpleNamespace(pid=43,poll=lambda:None,terminate=lambda:None,wait=lambda **kw:None)
        with patch.object(self.manager,'status',side_effect=[{'loaded':True,'variant':'q8'},{'loaded':False,'variant':'q8'},{'loaded':True,'variant':'stq'}]),patch.object(self.manager,'_process_info',side_effect=[old,old,new]),patch.object(self.manager,'_verify_model'),patch.object(self.manager,'_port_free',return_value=True),patch.object(self.manager,'_terminate_owned') as terminate,patch.object(self.mod.subprocess,'Popen',return_value=process) as launch:
            result=self.manager.start('stq')
        self.assertEqual(result['variant'],'stq')
        self.assertEqual(terminate.call_count,1)
        self.assertEqual(terminate.call_args.args[0]['pid'],42)
        self.assertEqual(launch.call_count,1)
        self.assertEqual(self.manager.selected_id(),'stq')

    def test_failed_requested_profile_never_starts_a_fallback(self):
        with patch.object(self.manager,'_verify_model',side_effect=RuntimeError('requested model unavailable')),patch.object(self.manager,'_port_free',return_value=True),patch.object(self.mod.subprocess,'Popen',side_effect=AssertionError('fallback started')):
            with self.assertRaisesRegex(RuntimeError,'requested'):
                self.manager.start('stq')

    def test_localizer_cache_isolated_by_current_profile_even_when_off(self):
        spec=importlib.util.spec_from_file_location('profile_localizer',Path(__file__).resolve().parents[2]/'localizer.py')
        localizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(localizer)
        localizer.CACHE_DIR=Path(self.tmp.name)/'cache'
        self.assertTrue(callable(getattr(self.manager,'translation_scope',None)))
        with patch.object(localizer,'_runtime',return_value=self.manager),patch.object(localizer,'_translate_local',return_value=['Q8 перевод']):
            localizer.translate(['hello'])
            self.manager._select_profile('stq')
            self.assertEqual(localizer.cache_lookup(['hello'])['texts'],[None])
            self.manager._select_profile('q8')
            self.assertEqual(localizer.cache_lookup(['hello'])['texts'],['Q8 перевод'])
