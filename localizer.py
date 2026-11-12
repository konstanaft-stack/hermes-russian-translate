"""Offline English-to-Russian UI translation with an explicitly loaded HY-MT2 profile.

No provider credentials, network fallback, model installation or catalog writes.
"""
from __future__ import annotations

from contextlib import closing
import hashlib
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import threading
import time
import types

MAX_TEXTS = 8
MAX_CHARS = 24000


def _hermes_home() -> Path:
    explicit = os.environ.get("HERMES_HOME")
    if explicit:
        return Path(explicit).expanduser().resolve()
    local = os.environ.get("LOCALAPPDATA")
    return (Path(local) / "hermes" if local else Path.home() / ".hermes").resolve()


HERMES_HOME = _hermes_home()
CACHE_DIR = HERMES_HOME / "cache" / "ru-translator"
# API and agent loaders can import this file under different module names.
_WORK_LOCK = sys.modules.setdefault(
    "_hermes_ru_translator_work_lock", types.SimpleNamespace(lock=threading.Lock())
).lock


def _db() -> sqlite3.Connection:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(CACHE_DIR / "cache.db")
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS translations ("
            " key TEXT PRIMARY KEY, src TEXT, lang TEXT, engine TEXT, out TEXT, ts REAL)"
        )
        return conn
    except Exception:
        conn.close()
        raise


def _key(text: str, lang: str, engine: str) -> str:
    return hashlib.sha256(f"{engine}|{lang}|{text}".encode("utf-8")).hexdigest()


def _validate_request(texts: list[str], lang: str, engine: str) -> None:
    if engine not in ("local", "auto"):
        raise ValueError("Доступен только local; облачный перевод отключён")
    if lang != "ru":
        raise ValueError("Локальный перевод поддерживает только язык ru")
    if not isinstance(texts, list) or not texts or any(not isinstance(t, str) for t in texts):
        raise ValueError("Нужен непустой массив строк texts")
    if len(texts) > MAX_TEXTS or sum(map(len, texts)) > MAX_CHARS:
        raise ValueError("Один пакет: не более 8 строк и 24000 символов")


def _validate_output(output, count: int) -> list[str]:
    if not isinstance(output, list) or len(output) != count:
        raise RuntimeError("Некорректный результат локального перевода: размер массива")
    if any(not isinstance(t, str) or not t.strip() for t in output):
        raise RuntimeError("Некорректный результат локального перевода: пустая строка или тип")
    return output


def _runtime():
    name = 'hermes_ru_hymt_runtime'
    with _RUNTIME_LOAD_LOCK:
        module = sys.modules.get(name)
        if module is None:
            spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / 'hymt_runtime.py')
            if spec is None or spec.loader is None:
                raise RuntimeError('Локальный модуль HY-MT2 отсутствует')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            sys.modules[name] = module
        return module


_RUNTIME_LOAD_LOCK = threading.Lock()


def _translate_local(texts: list[str]) -> list[str]:
    return _validate_output(_runtime().translate(texts), len(texts))


def translate(texts: list[str], lang: str = "ru", engine: str = "local") -> dict:
    """Translate bounded batches, preserving every input position, including blanks."""
    _validate_request(texts, lang, engine)
    with _runtime().translation_scope() as epoch, _WORK_LOCK, closing(_db()) as conn:
        keys = [_key(t, "ru", epoch) for t in texts]
        query = "SELECT key, out FROM translations WHERE key IN (%s)" % ",".join("?" * len(keys))
        found = {k: out for k, out in conn.execute(query, keys).fetchall()
                 if isinstance(out, str) and out.strip()}
        missing = {}
        for text, key in zip(texts, keys):
            if text.strip() and key not in found:
                missing.setdefault(key, text)
        if missing:
            output = _validate_output(_translate_local(list(missing.values())), len(missing))
            now = time.time()
            # Validate the entire batch before the first write; rollback on any DB error.
            with conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO translations VALUES (?,?,?,?,?,?)",
                    [(k, src, "ru", epoch, out, now)
                     for (k, src), out in zip(missing.items(), output)],
                )
            found.update(zip(missing, output))
        result = [found[key] if text.strip() else text for text, key in zip(texts, keys)]
        translated = sum(bool(text.strip()) and key in missing for text, key in zip(texts, keys))
        return {"texts": result, "engine": "local", "cached": len(texts) - translated,
                "translated": translated, "cache_epoch": epoch}


def status() -> dict:
    """Availability check only: no model import, credential read or translation."""
    with closing(_db()) as conn:
        rows = conn.execute("SELECT engine, COUNT(*) FROM translations GROUP BY engine").fetchall()
    runtime = _runtime().status()
    return {**runtime, "engines": {"local": runtime['available'], "model": False},
            "engine": "local", "lang": "ru", "local_only": True,
            "cache": dict(rows), "limits": {"texts": MAX_TEXTS, "chars": MAX_CHARS},
            "catalog": {"mutation_enabled": False}}


def cache_lookup(texts, lang='ru', engine='local'):
    """Read only existing requested cache rows; never wait for the inference lock."""
    _validate_request(texts, lang, engine)
    epoch = _runtime().cache_epoch()
    keys = [_key(text, 'ru', epoch) for text in texts]
    found = {}
    database = CACHE_DIR / 'cache.db'
    if database.is_file():
        try:
            with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=.05)) as conn:
                query = 'SELECT key,out FROM translations WHERE key IN (%s)' % ','.join('?' * len(keys))
                found = {key:out for key,out in conn.execute(query,keys) if isinstance(out,str) and out.strip()}
        except sqlite3.OperationalError:
            # A writer must never turn an instant cache lookup into a long inference wait.
            found = {}
    output = [found.get(key) if text.strip() else text for key,text in zip(keys,texts)]
    missed = sum(value is None for value in output)
    return {'texts':output,'cached':len(texts)-missed,'missed':missed,'engine':'local','cache_epoch':epoch}


def engine_start(variant='q8'):
    return _runtime().start(variant)


def engine_stop():
    return _runtime().stop()


def apply_catalog() -> dict:
    return {"ok": False, "error": "Запись каталога отключена: перевод меняет только отображение страницы Plugins"}
