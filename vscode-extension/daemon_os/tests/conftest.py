import sys
from pathlib import Path

# Ensure daemon_os root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
