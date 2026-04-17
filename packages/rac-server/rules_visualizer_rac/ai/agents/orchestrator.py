"""RAC AI orchestrator — mirrors the factgraph orchestrator."""

from __future__ import annotations

from typing import Any, AsyncGenerator

from langchain_core.messages import AIMessageChunk
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import InMemorySaver

from rules_visualizer_rac.ai.config import ChatContext, get_model
from rules_visualizer_rac.ai.tools.search import SEARCH_TOOLS

# Shared checkpointers per thread
_checkpointers: dict[str, InMemorySaver] = {}


def _get_checkpointer(thread_id: str) -> InMemorySaver:
    if thread_id not in _checkpointers:
        _checkpointers[thread_id] = InMemorySaver()
    return _checkpointers[thread_id]


def _system_prompt(ctx: ChatContext) -> str:
    return "\n\n".join([
        "You are an AI assistant helping users understand a RAC ruleset.",
        "You can use tools to look up nodes, search, and explore dependencies. "
        "Keep answers concise — only provide information needed to answer the question. "
        "Reference specific node names so the user can click them. "
        "NEVER wrap node names in backticks or code formatting — just write them as plain text.",
        "When explaining logic, reference the actual node names from the ruleset.",
        f'The ruleset_id for tool calls is: "{ctx.ruleset_id}"',
    ])


async def stream_agent(
    ctx: ChatContext,
    message: str,
    thread_id: str,
    history: list[dict[str, str]] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    model = get_model()
    checkpointer = _get_checkpointer(thread_id)

    agent = create_react_agent(
        model=model,
        tools=SEARCH_TOOLS,
        checkpointer=checkpointer,
        prompt=_system_prompt(ctx),
    )

    messages: list[dict[str, str]] = []
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": message})

    try:
        # Track tool call IDs so we can match start → end
        pending_tools: list[dict[str, str]] = []

        async for event in agent.astream_events(
            {"messages": messages},
            config={"configurable": {"thread_id": thread_id}},
            version="v2",
        ):
            if event["event"] == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if isinstance(chunk, AIMessageChunk):
                    content = chunk.content
                    if isinstance(content, str) and content:
                        yield {"type": "text", "content": content}

                    if chunk.tool_call_chunks:
                        for tc in chunk.tool_call_chunks:
                            if tc.get("name") and tc.get("id"):
                                pending_tools.append(
                                    {"name": tc["name"], "id": tc["id"]}
                                )
                                yield {
                                    "type": "tool_start",
                                    "name": tc["name"],
                                    "id": tc["id"],
                                }

            if event["event"] == "on_tool_end":
                output = event.get("data", {}).get("output")
                tool_name = event.get("name", "unknown")

                # Find matching pending tool by name
                tool_id = "unknown"
                for i, pt in enumerate(pending_tools):
                    if pt["name"] == tool_name:
                        tool_id = pending_tools.pop(i)["id"]
                        break

                result = output.content if hasattr(output, "content") else str(output)

                yield {
                    "type": "tool_end",
                    "name": tool_name,
                    "id": tool_id,
                    "result": result,
                    "status": "success",
                }

        yield {"type": "done"}
    except Exception as e:
        yield {"type": "error", "content": str(e)}
