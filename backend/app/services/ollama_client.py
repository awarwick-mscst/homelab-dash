import httpx

from app.config import settings


class OllamaClient:
    def __init__(self):
        self._base_url: str = ""
        self._model: str = "llama3"
        self._configure()

    def _configure(self):
        if settings.ollama_host:
            self._base_url = settings.ollama_host.rstrip("/")
            self._model = settings.ollama_model or "llama3"

    def update_config(self, host: str, model: str = "llama3"):
        self._base_url = host.rstrip("/") if host else ""
        self._model = model or "llama3"

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url)

    @property
    def model(self) -> str:
        return self._model

    async def generate(self, prompt: str, system: str | None = None) -> str:
        payload: dict = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{self._base_url}/api/generate", json=payload)
            resp.raise_for_status()
            return resp.json().get("response", "")

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base_url}/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])

    async def check_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self._base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False


ollama_client = OllamaClient()
