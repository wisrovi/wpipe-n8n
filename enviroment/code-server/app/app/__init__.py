"""Application package for main_pipeline.

Provides package exports and pipeline build helper functions.
"""

from pipelines import build_pipeline, execute_pipeline

__version__ = "1.0.0"
__author__ = "William Rodriguez (wisrovi)"

__all__ = ["__author__", "__version__", "build_pipeline", "execute_pipeline"]
