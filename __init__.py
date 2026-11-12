"""Плагин hermes-ru-translator — регистрация инструментов перевода."""
from __future__ import annotations

import json
import logging

from . import localizer

log = logging.getLogger(__name__)


def _schema_translate() -> dict:
    return {
        "name": "ru_translate",
        "description": (
            "Перевод английского текста на русский через явно загруженный локальный профиль HY-MT2. "
            "Не более 8 строк / 24000 символов. Автозапуск, облако и скачивание отключены."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Одна строка для перевода."},
                "texts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Несколько строк для пакетного перевода.",
                },
                "lang": {"type": "string", "enum": ["ru"], "description": "Только русский, ru."},
                "engine": {
                    "type": "string",
                    "enum": ["local"],
                    "description": "Только загруженный локальный HY-MT2; без fallback.",
                },
            },
        },
    }


def _schema_status() -> dict:
    return {
        "name": "ru_translate_status",
        "description": "Выбранный профиль HY-MT2, CPU/GPU, состояние загрузки и кэш; без автозагрузки модели.",
        "parameters": {"type": "object", "properties": {}},
    }


def _schema_apply() -> dict:
    return {
        "name": "ru_catalog_apply",
        "description": (
            "Устаревший инструмент отключён: запись каталога запрещена, перевод меняет только отображение."
        ),
        "parameters": {"type": "object", "properties": {}},
    }


def _translate(args: dict, **kwargs) -> str:
    try:
        texts = args.get("texts") or ([args["text"]] if "text" in args else [])
        if not texts:
            return json.dumps({"error": "нужен text или texts"}, ensure_ascii=False)
        out = localizer.translate(texts, lang=args.get("lang", "ru"), engine=args.get("engine", "local"))
        if args.get("text") and not args.get("texts"):
            out["text"] = out["texts"][0]
        return json.dumps(out, ensure_ascii=False)
    except Exception as exc:  # never raise out of a tool
        log.warning("ru_translate failed: %s", exc)
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)


def _status(args: dict, **kwargs) -> str:
    try:
        return json.dumps(localizer.status(), ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)


def _apply(args: dict, **kwargs) -> str:
    try:
        return json.dumps(localizer.apply_catalog(), ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)


def register(ctx) -> None:
    ctx.register_tool(name="ru_translate", toolset="translator",
                      schema=_schema_translate(), handler=_translate)
    ctx.register_tool(name="ru_translate_status", toolset="translator",
                      schema=_schema_status(), handler=_status)
    ctx.register_tool(name="ru_catalog_apply", toolset="translator",
                      schema=_schema_apply(), handler=_apply)
    log.info("hermes-ru-translator: инструменты ru_translate / ru_translate_status / ru_catalog_apply")
