import os
import pytest

EXTERNAL_SIDE_EFFECT_MARKERS = ("email", "mail", "graph", "send")


def pytest_collection_modifyitems(config, items):
    """Hard guard: any test module whose name suggests mail/Graph is skipped unless explicitly opted in."""
    if os.environ.get("SPOT_ALLOW_EMAIL_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="External side-effect test (mail/Graph) — opt in with SPOT_ALLOW_EMAIL_TESTS=1")
    for item in items:
        name = os.path.basename(str(item.fspath)).lower()
        if any(m in name for m in EXTERNAL_SIDE_EFFECT_MARKERS):
            item.add_marker(skip)
