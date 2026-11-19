"""Native Hindsight-style memory engine.

The engine is a source-level port of the mechanisms in
https://github.com/vectorize-io/hindsight (MIT) into RAGFlow's own memory
package: facts are extracted by the tenant's chat model, embedded with the
tenant's embedding model, stored in a local SQLite bank, and recalled with the
same hybrid pipeline Hindsight uses (semantic + BM25 + graph + temporal arms,
reciprocal rank fusion, recency/temporal/proof boosts, token budget packing).

Nothing here talks to an external Hindsight server: the algorithms live in this
package and the only external calls are the tenant's own LLM and embedding
models, which RAGFlow already bills and traces.
"""

from memory.hindsight.engine import HindsightEngine, get_hindsight_engine

__all__ = ["HindsightEngine", "get_hindsight_engine"]
