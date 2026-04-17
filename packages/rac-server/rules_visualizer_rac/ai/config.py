from __future__ import annotations

import os
from dataclasses import dataclass

from langchain_openai import ChatOpenAI


@dataclass
class ChatContext:
    ruleset_id: str


def get_model(model_id: str | None = None) -> ChatOpenAI:
    api_key = os.environ.get("OPEN_ROUTER_KEY")
    if not api_key:
        raise RuntimeError("OPEN_ROUTER_KEY environment variable is required")

    return ChatOpenAI(
        model=model_id or os.environ.get("AI_MODEL", "openai/gpt-oss-120b"),
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        streaming=True,
        default_headers={
            "HTTP-Referer": "https://rules-visualizer.local",
            "X-Title": "Rules Visualizer",
        },
    )
