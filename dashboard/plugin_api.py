"""HTTP-бэкенд переводчика: /api/plugins/hermes-ru-translator/*.

Тонкая обёртка над localizer.py — тот же код, что и у инструментов агента.
"""
import importlib.util
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StrictStr

router = APIRouter()

_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
_LOAD_LOCK = threading.Lock()


def _localizer():
    """Загружает localizer.py из корня плагина (папка с дефисом не импортируется как пакет)."""
    with _LOAD_LOCK:
        cached = sys.modules.get("hermes_ru_localizer")
        if cached is not None:
            return cached
        spec = importlib.util.spec_from_file_location("hermes_ru_localizer", _PLUGIN_ROOT / "localizer.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("localizer.py не найден")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        sys.modules["hermes_ru_localizer"] = module
        return module


class TranslateBody(BaseModel):
    texts: list[StrictStr] = Field(default_factory=list)
    text: StrictStr | None = None
    lang: str = "ru"
    engine: str = "local"


class StartBody(BaseModel):
    variant: str = 'q8'


@router.get("/status")
def status() -> dict[str, Any]:
    try:
        return _localizer().status()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.post("/translate")
def translate(body: TranslateBody) -> dict[str, Any]:
    texts = body.texts or ([body.text] if body.text is not None else [])
    if not texts:
        raise HTTPException(status_code=400, detail="нужен text или texts")
    try:
        return _localizer().translate(texts, lang=body.lang, engine=body.engine)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.post("/catalog/apply")
def catalog_apply() -> dict[str, Any]:
    raise HTTPException(status_code=410, detail="Запись каталога отключена: доступен только перевод отображения Plugins")


@router.post('/cache/lookup')
def cache_lookup(body: TranslateBody) -> dict[str, Any]:
    try:
        texts = body.texts or ([body.text] if body.text is not None else [])
        return _localizer().cache_lookup(texts, lang=body.lang, engine=body.engine)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/engine/start')
def engine_start(body: StartBody) -> dict[str, Any]:
    try:
        return _localizer().engine_start(body.variant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post('/engine/stop')
def engine_stop() -> dict[str, Any]:
    try:
        return _localizer().engine_stop()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
