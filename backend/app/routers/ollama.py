from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user
from app.models.user import User
from app.services.ollama_client import ollama_client

router = APIRouter(prefix="/api/ollama", tags=["ollama"])


@router.get("/models")
async def list_models(_: User = Depends(get_current_user)):
    if not ollama_client.is_configured:
        raise HTTPException(status_code=400, detail="Ollama not configured")
    try:
        models = await ollama_client.list_models()
        return {"models": [{"name": m.get("name", ""), "size": m.get("size", 0)} for m in models]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/status")
async def get_status(_: User = Depends(get_current_user)):
    if not ollama_client.is_configured:
        return {"connected": False, "host": ""}
    connected = await ollama_client.check_connection()
    return {"connected": connected, "host": ollama_client._base_url, "model": ollama_client.model}
