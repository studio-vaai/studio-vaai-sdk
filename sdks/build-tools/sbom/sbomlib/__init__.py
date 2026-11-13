"""Shared SBOM generation and release tools; SDK-local only."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'resources'
