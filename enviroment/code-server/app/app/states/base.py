"""Abstract base step for WPipe microservices."""

from abc import ABC, abstractmethod
from typing import Any


class BaseStep(ABC):
    """Base class defining the contract for all WPipe state steps."""

    @abstractmethod
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute step logic mutating the shared pipeline context.

        Args:
            context (Any): Typed pipeline context or dictionary.

        Returns:
            dict[str, Any]: Mutated execution context dictionary.
        """
        raise NotImplementedError("Step implementation must override __call__")
