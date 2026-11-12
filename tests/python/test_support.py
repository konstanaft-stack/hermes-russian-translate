"""Shared isolation for release tests; no real user cache/config is read."""
import os
import sys
from unittest.mock import patch


def isolated_home(case, home):
    environment = patch.dict(os.environ, {'HERMES_HOME': str(home)})
    environment.start()
    case.addCleanup(environment.stop)
    name = '_hermes_ru_hymt_runtime_manager'
    previous = sys.modules.pop(name, None)
    def restore():
        sys.modules.pop(name, None)
        if previous is not None:
            sys.modules[name] = previous
    case.addCleanup(restore)
