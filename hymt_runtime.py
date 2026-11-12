"""Explicitly controlled, owned, loopback-only HY-MT2 CPU/GPU profile runtime.

Import/status/translation never start a model. No provider config, downloads or fallback.
"""
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

PLUGIN_ROOT = Path(__file__).resolve().parent
SERVER_NAME = 'llama-server.exe' if os.name == 'nt' else 'llama-server'
SERVER = PLUGIN_ROOT / 'vendor' / 'llama-cpu' / SERVER_NAME
MODEL = PLUGIN_ROOT / 'models' / 'Hy-MT2-1.8B-Q8_0.gguf'
MODEL_SHA256 = '5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4'
MODEL_REVISION = 'a0c709d9fac510f2c807aa3af52872340dc37a4a'
MODEL_BYTES = 1908528192
ALIAS = 'hermes-hymt2-q8'
CACHE_EPOCH = 'hymt2-q8-a0c709d9-mechanical-v3'
PROFILES = {
    'q8':dict(label='HY-MT2 Q8',role='quality',device='cpu',server=SERVER,model=MODEL,
        sha256=MODEL_SHA256,bytes=MODEL_BYTES,revision=MODEL_REVISION,alias=ALIAS,epoch=CACHE_EPOCH,ctx=8192,batch=512),
    'stq':dict(label='HY-MT2 STQ 1.25-bit',role='compact_cpu',device='cpu',
        server=PLUGIN_ROOT / 'vendor' / 'llama-stq' / SERVER_NAME,
        model=PLUGIN_ROOT / 'models' / 'Hy-MT2-1.8B-1.25Bit-stq43-compat.gguf',
        sha256='f1e0adf9183536e42589650348305176c570be9e588fe6955bcdef82d7f66a01',bytes=461860800,
        revision='stq43-compat-f1e0ad',alias='hermes-hymt2-stq',epoch='stq-compat-f1e0ad-v1',ctx=4096,batch=256),
    'stream':dict(label='HY-MT2 StreamRevise v4',role='complete_first_chunk_translation',device='gpu',server=PLUGIN_ROOT / 'vendor' / 'llama-gpu' / SERVER_NAME,
        model=PLUGIN_ROOT / 'models' / 'Hy-MT2-1.8B-StreamRevise-v4-Q4_K_M.gguf',
        sha256='3bc3d83a15e9770338eee58183571f10b6af0adcef1bb65544feae4056266620',bytes=1069288640,
        revision='e831109ad7153a2476d298f2cb14ab930b5e9b4f',alias='hermes-streamrevise',
        epoch='streamrevise-e831109a-v1',ctx=8192,batch=512),
}
PORT = 18961
_TOKENS = re.compile(
    r'`[^`\r\n]*`|(?:https?|file)://[^\s<>"`]*|'
    r'\b(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*[:=]\s*(?i:true|false|off|on)\b|'
    r'(?<![\w:])[A-Za-z]:[\\/][^\s<>"`]*|'
    r'(?:\.{1,2}[\\/]|~/|(?<![\w.])/(?!/))[^\s<>"`]+|'
    r'\b[A-Z][A-Z0-9_]*_[A-Z0-9_*]+(?:/[^\s<>"`]*)?|'
    r'(?<![\w.])[A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)+/?|'
    r'\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b|'
    r'\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b'
)


def _critical_spans(text):
    spans = []
    for match in _TOKENS.finditer(text):
        start, end = match.span()
        if not text[start:end].startswith('`'):
            while end > start and text[end - 1] in '.,;!?':
                end -= 1
            while end > start and text[end - 1] in ')]}':
                close = text[end - 1]
                opening = {')':'(', ']':'[', '}':'{'}[close]
                token = text[start:end]
                if token.count(close) <= token.count(opening):
                    break
                end -= 1
        if end > start:
            spans.append((start,end))
    return spans


def _split_text(text):
    spans = _critical_spans(text)
    if len(spans) > 128:
        raise ValueError('Не более 128 технических фрагментов в строке')
    if any(end-start > 3000 for start,end in spans):
        raise ValueError('Один технический фрагмент превышает 3000 символов')
    def safe(at):
        return not any(start < at < end for start,end in spans)
    pieces = []
    start = 0
    while len(text)-start > 3000:
        limit = start+3000
        preferred = [start+m.end() for m in re.finditer(r'\n\s*\n|(?<=[.!?])\s+',text[start:limit]) if safe(start+m.end())]
        if preferred:
            cut = preferred[-1]
        else:
            spaces = [start+m.end() for m in re.finditer(r'\s+',text[start:limit]) if safe(start+m.end())]
            cut = spaces[-1] if spaces else limit
            if not safe(cut):
                cut = next(begin for begin,end in spans if begin < cut < end)
        if cut <= start:
            raise ValueError('Не удалось безопасно разделить текст')
        pieces.append(text[start:cut])
        start = cut
    pieces.append(text[start:])
    return pieces



class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Local translation redirects are disabled')


def hermes_home():
    explicit = os.environ.get('HERMES_HOME')
    if explicit:
        return Path(explicit).expanduser().resolve()
    local = os.environ.get('LOCALAPPDATA')
    return (Path(local) / 'hermes' if local else Path.home() / '.hermes').resolve()


def configured_profiles(config_path):
    """Read local paths and explicit device settings; immutable model pins cannot change."""
    try:
        config = json.loads(config_path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        config = {}
    except (OSError, ValueError) as exc:
        raise ValueError('Не удалось прочитать ru-translator/runtime.json') from exc
    allowed = {'schema_version','device','cpu_threads','gpu_layers','gpu_device','profiles'}
    if not isinstance(config,dict) or set(config)-allowed or config.get('schema_version',1)!=1:
        raise ValueError('Неподдерживаемая конфигурация runtime.json')
    device=config.get('device','cpu')
    if device not in ('cpu','gpu'):
        raise ValueError('device должен быть cpu или gpu')
    threads=config.get('cpu_threads',min(8,os.cpu_count() or 1))
    layers=config.get('gpu_layers',99)
    if type(threads) is not int or threads<1 or type(layers) is not int or not 1<=layers<=999:
        raise ValueError('Некорректные cpu_threads или gpu_layers')
    gpu_device=config.get('gpu_device')
    if gpu_device is not None and (not isinstance(gpu_device,str) or not gpu_device.strip() or len(gpu_device)>100):
        raise ValueError('Некорректное имя gpu_device')
    overrides=config.get('profiles',{})
    if not isinstance(overrides,dict) or set(overrides)-set(PROFILES):
        raise ValueError('Неизвестный профиль runtime.json')
    output={}
    for key,source in PROFILES.items():
        if key!='q8' and key not in overrides:
            continue
        profile=dict(source)
        override=overrides.get(key,{})
        if not isinstance(override,dict) or set(override)-{'server','model'}:
            raise ValueError('В профиле разрешены только пути server/model')
        if key!='q8' and set(override)!={'server','model'}:
            raise ValueError('Дополнительный профиль требует явные server и model')
        if key=='q8':
            profile['device']=device
            profile['server']=PLUGIN_ROOT / 'vendor' / ('llama-'+device) / SERVER_NAME
        for name,value in override.items():
            if not isinstance(value,str) or not value.strip() or '://' in value or value.startswith(('//', '\\\\')):
                raise ValueError('Нужен локальный путь server/model')
            path=Path(value).expanduser()
            profile[name]=(path if path.is_absolute() else config_path.parent / path).resolve()
        profile.update(threads=min(8,threads),gpu_layers=layers,gpu_device=gpu_device)
        output[key]=profile
    return output


class RuntimeManager:
    def __init__(self, state_dir, config_path=None):
        self.state_dir = Path(state_dir)
        self.config_path = Path(config_path) if config_path else hermes_home() / 'ru-translator' / 'runtime.json'
        self.receipt_path = self.state_dir / 'owned-runtime.json'
        self.token_path = self.state_dir / 'auth.token'
        self.selection_path = self.state_dir / 'selected-profile.json'
        self._generation = threading.RLock()
        self._lifecycle = self._generation
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    @property
    def profiles(self):
        return configured_profiles(self.config_path)

    def selected_id(self):
        try:
            selected=json.loads(self.selection_path.read_text(encoding='utf-8')).get('variant')
            if selected in self.profiles:return selected
        except (OSError,ValueError,AttributeError):
            pass
        receipt=self._receipt()
        return receipt.get('variant','q8') if receipt and receipt.get('variant','q8') in self.profiles else 'q8'

    def _select_profile(self, variant):
        if variant not in self.profiles:raise ValueError('Неизвестный локальный профиль перевода')
        self.state_dir.mkdir(parents=True,exist_ok=True)
        temporary=self.selection_path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'variant':variant}),encoding='utf-8')
        os.replace(temporary,self.selection_path)

    def cache_epoch(self):
        return self.profiles[self.selected_id()]['epoch']

    @contextmanager
    def translation_scope(self):
        with self._generation:
            yield self.cache_epoch()

    def _argv(self,variant,profile=None):
        profile=self.profiles[variant] if profile is None else profile
        args=[str(profile['server']),'--model',str(profile['model']),'--host','127.0.0.1','--port',str(PORT),
              '--alias',profile['alias'],'--n-gpu-layers','0' if profile['device']=='cpu' else str(profile['gpu_layers']),
              '--ctx-size',str(profile['ctx']),'--parallel','1','--batch-size',str(profile['batch']),
              '--ubatch-size','128','--api-key-file',str(self.token_path),'--no-webui']
        if profile['device']=='cpu':
            args+=['--threads', str(profile['threads'])]
        elif profile.get('gpu_device'):
            args+=['--device',profile['gpu_device']]
        return args

    def _receipt(self):
        try:
            data = json.loads(self.receipt_path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def _write_receipt(self, receipt):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.receipt_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temporary, self.receipt_path)

    def _process_info(self, pid):
        import psutil
        try:
            proc = psutil.Process(int(pid))
            return {'pid': proc.pid, 'created': proc.create_time(), 'exe': proc.exe(), 'argv': proc.cmdline()}
        except (psutil.Error, OSError, ValueError):
            return None

    @staticmethod
    def _same_process(receipt, live):
        if not receipt or not live:
            return False
        return (receipt.get('pid') == live.get('pid') and receipt.get('created') == live.get('created')
                and os.path.normcase(receipt.get('exe', '')) == os.path.normcase(live.get('exe', ''))
                and receipt.get('argv') == live.get('argv'))

    def _port_free(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(('127.0.0.1', PORT))
                return True
            except OSError:
                return False

    def _request(self, path, payload=None, timeout=5):
        if path not in ('/health', '/v1/chat/completions'):
            raise ValueError('Only fixed owned loopback runtime routes are allowed')
        try:
            token = self.token_path.read_text(encoding='ascii').strip()
            if not token:
                raise RuntimeError('Local translation authentication is unavailable')
            body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request('http://127.0.0.1:%d%s' % (PORT, path), data=body,
                headers={'Content-Type':'application/json', 'Authorization':'Bearer ' + token})
            with self._opener.open(req, timeout=timeout) as response:
                if response.geturl() != req.full_url:
                    raise RuntimeError('Local translation redirected unexpectedly')
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise RuntimeError('Local translation response is too large')
                return json.loads(raw.decode('utf-8', errors='strict'))
        except (OSError, ValueError, urllib.error.URLError) as exc:
            raise RuntimeError('Локальный HY-MT2 не ответил; облачный fallback отключён') from exc

    def status(self):
        receipt=self._receipt()
        live=self._process_info(receipt['pid']) if receipt and 'pid' in receipt else None
        owned=self._same_process(receipt,live)
        ready=False
        if owned:
            try:ready=self._request('/health',timeout=1).get('status')=='ok'
            except RuntimeError:pass
        variant=receipt.get('variant','q8') if owned else self.selected_id()
        profile=dict(self.profiles.get(variant,self.profiles['q8']))
        if owned and receipt.get('device') in ('cpu','gpu'):
            profile['device']=receipt['device']
        return {'loaded':ready,'ready':ready,'owned':owned,'pid':receipt.get('pid') if owned else None,
                'model':profile['alias'],'model_label':profile['label'],'variant':variant,'device':profile['device'],
                'gpu_backend':'configured' if profile['device']=='gpu' else None,
                'cache_epoch':profile['epoch'],'model_revision':profile['revision'],
                'available':profile['server'].is_file() and profile['model'].is_file(),
                'enabled_variants':list(self.profiles),
                'profiles':[{'id':key,'label':value['label'],'device':value['device'],'role':value['role']} for key,value in self.profiles.items()]}

    def _require_loaded(self):
        if not self.status()['loaded']:
            raise RuntimeError('HY-MT2 не загружен. Нажмите «Загрузить переводчик»; автоматический запуск отключён')

    def _verify_model(self,variant='q8',profile=None):
        profile=self.profiles[variant] if profile is None else profile
        if not profile['server'].is_file() or not profile['model'].is_file():
            raise RuntimeError('Локальные файлы профиля отсутствуют; загрузка отключена')
        if profile['model'].stat().st_size!=profile['bytes']:
            raise RuntimeError('Файл модели не соответствует согласованному размеру')
        digest=hashlib.sha256()
        with profile['model'].open('rb') as stream:
            for chunk in iter(lambda:stream.read(8*1024*1024),b''):digest.update(chunk)
        if digest.hexdigest()!=profile['sha256']:raise RuntimeError('SHA256 локальной модели не совпадает')

    def _child_env(self):
        names = ('SYSTEMROOT','WINDIR','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP')
        return {name:os.environ[name] for name in names if name in os.environ}

    def start(self, variant='q8'):
        if variant not in self.profiles:
            raise ValueError('Неизвестный локальный профиль перевода')
        with self._lifecycle:
            # One configuration snapshot binds hash verification, argv and receipt.
            profile=self.profiles[variant]
            current = self.status()
            if (current['loaded'] and current.get('variant',self.selected_id())==variant
                    and current.get('device') == profile['device']):
                return current
            receipt = self._receipt()
            if receipt:
                live=self._process_info(receipt.get('pid'))
                if live and not self._same_process(receipt,live):
                    raise RuntimeError('Существующий процесс не принадлежит переводчику')
                if live and receipt.get('variant','q8')==variant and not current['loaded']:
                    raise RuntimeError('Выбранный профиль ещё запускается')
                if live:
                    self._verify_model(variant,profile=profile)
                    self.stop()
            if not self._port_free():
                raise RuntimeError('Локальный порт 18961 занят; чужой процесс не будет остановлен')
            self._verify_model(variant,profile=profile)
            self._select_profile(variant)
            self.state_dir.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(self.token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, 'w', encoding='ascii') as stream:
                stream.write(secrets.token_urlsafe(32))
            argv = self._argv(variant,profile=profile)
            proc = None
            try:
                # Keep native load diagnostics; authentication remains in its separate key file.
                with (self.state_dir / 'server.stderr.log').open('ab') as diagnostics:
                    proc = subprocess.Popen(argv, cwd=str(profile['server'].parent), env=self._child_env(),
                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=diagnostics,
                        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                info = self._process_info(proc.pid)
                if info is None:
                    # We still hold the original Popen handle, never an arbitrary PID.
                    proc.terminate()
                    proc.wait(timeout=10)
                    raise RuntimeError('Нельзя подтвердить принадлежность нового процесса HY-MT2')
                info.update(variant=variant, device=profile['device'], model=str(profile['model']), model_sha256=profile['sha256'],
                            argv_sha256=hashlib.sha256(json.dumps(info['argv']).encode('utf-8')).hexdigest())
                self._write_receipt(info)
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        raise RuntimeError('Локальный сервер HY-MT2 завершился при загрузке')
                    ready = self.status()
                    if ready['loaded']:
                        return ready
                    time.sleep(.25)
                raise RuntimeError('HY-MT2 не загрузился за 120 секунд')
            except Exception:
                owned = self._receipt()
                if owned and self._same_process(owned, self._process_info(owned.get('pid'))):
                    self._terminate_owned(owned)
                elif proc is not None and proc.poll() is None:
                    # Receipt persistence failed: the original Popen handle still owns this child.
                    proc.terminate()
                    proc.wait(timeout=10)
                self.receipt_path.unlink(missing_ok=True)
                self.token_path.unlink(missing_ok=True)
                raise

    def _terminate_owned(self, receipt):
        import psutil
        proc = psutil.Process(receipt['pid'])
        live = {'pid':proc.pid,'created':proc.create_time(),'exe':proc.exe(),'argv':proc.cmdline()}
        if not self._same_process(receipt, live):
            raise RuntimeError('Процесс не принадлежит переводчику; остановка запрещена')
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except psutil.TimeoutExpired:
            # psutil verifies process creation identity again before signalling.
            proc.kill()
            proc.wait(timeout=10)

    def stop(self):
        with self._lifecycle:
            receipt = self._receipt()
            if receipt:
                live = self._process_info(receipt.get('pid'))
                if live and not self._same_process(receipt, live):
                    raise RuntimeError('Процесс не принадлежит переводчику; остановка запрещена')
                if live:
                    self._terminate_owned(receipt)
                try:
                    self._select_profile(receipt.get('variant') if receipt.get('variant') in self.profiles else 'q8')
                except ValueError:
                    # A broken path/device setting must never prevent owned unload.
                    pass
                finally:
                    self.receipt_path.unlink(missing_ok=True)
                    self.token_path.unlink(missing_ok=True)
            self.token_path.unlink(missing_ok=True)
            try:
                return self.status()
            except ValueError as exc:
                return {'loaded': False, 'ready': False, 'owned': False, 'pid': None,
                        'available': False, 'configuration_error': str(exc)}

    def _plain_request(self, text, timeout=150):
        instruction = ('Translate the following text into Russian. Note that you should only output '
                       'the translated result without any additional explanation. Preserve all URLs, '
                       'code in backticks and file paths exactly as written:')
        data = self._request('/v1/chat/completions', {'model':self.profiles[self.selected_id()]['alias'],
            'messages':[{'role':'user','content':instruction+'\n\n'+text}],
            'temperature':0,'top_p':.6,'top_k':20,'repeat_penalty':1.05,
            'max_tokens':4096,'stream':False}, timeout=timeout)
        try:
            choice = data['choices'][0]
            output = choice['message']['content']
            if choice.get('finish_reason') != 'stop' or not isinstance(output,str) or not output.strip():
                raise ValueError('incomplete or empty generation')
            if re.search(r'__L\d+__|__HMT_', output):
                raise ValueError('unexpected technical marker')
            return output.strip()
        except (KeyError,TypeError,ValueError,IndexError) as exc:
            raise RuntimeError('Некорректный результат HY-MT2: пустой или неполный перевод') from exc

    def _mechanical_chunk(self, text, memo, deadline):
        def prose(span):
            begin,end=0,len(span)
            # Framing belongs to the source, including whitespace, punctuation and brackets.
            while begin < end and not (span[begin].isalnum() or span[begin]=='_'):
                begin+=1
            while end > begin and not (span[end-1].isalnum() or span[end-1]=='_'):
                end-=1
            core=span[begin:end]
            if not re.search(r'[A-Za-z]',core):
                return span
            if core not in memo:
                remaining=deadline-time.monotonic()
                if remaining<=0:
                    raise RuntimeError('Перевод превысил общий лимит 150 секунд')
                memo[core]=self._plain_request(core,timeout=min(150,remaining))
            return span[:begin]+memo[core]+span[end:]
        output=[]
        position=0
        for begin,end in _critical_spans(text):
            output.extend((prose(text[position:begin]),text[begin:end]))
            position=end
        output.append(prose(text[position:]))
        return ''.join(output)

    def translate(self, texts):
        if not isinstance(texts,list) or not texts or len(texts)>8 or any(not isinstance(t,str) for t in texts) or sum(map(len,texts))>24000:
            raise ValueError('Не более 8 строк / 24000 символов')
        chunks=[_split_text(text) for text in texts]
        with self._generation:
            deadline=time.monotonic()+150
            self._require_loaded()
            memo={}
            # Literal spans never enter model input. A later error aborts the entire result.
            return [''.join(self._mechanical_chunk(chunk,memo,deadline) for chunk in parts) for parts in chunks]


def manager():
    name = '_hermes_ru_hymt_runtime_manager'
    current = sys.modules.get(name)
    if current is None:
        home = hermes_home()
        current = sys.modules.setdefault(name, RuntimeManager(home / 'cache' / 'ru-translator' / 'hymt-runtime'))
    return current


def start(variant='q8'):
    return manager().start(variant)


def stop():
    return manager().stop()


def status():
    return manager().status()


def translate(texts):
    return manager().translate(texts)


def cache_epoch():
    return manager().cache_epoch()


def translation_scope():
    return manager().translation_scope()
