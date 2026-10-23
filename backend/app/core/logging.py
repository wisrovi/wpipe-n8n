import json
import logging
import sys
from datetime import UTC, datetime

_CONFIGURED_FLAG = "_wpipe_studio_configured"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if getattr(root, _CONFIGURED_FLAG, False):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    setattr(root, _CONFIGURED_FLAG, True)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)