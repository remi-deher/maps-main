#!/usr/bin/env python3
"""Protocol conformance check: keep the AsyncAPI spec and the three client
implementations (Go engine, iOS app, Tauri app) from drifting apart.

The WebSocket protocol's message `type` strings are declared independently in
four places — the spec and each implementation. Nothing stopped them from
diverging: a type renamed in the engine, or a new action wired into a client,
would silently desync the others. This script makes `spec/asyncapi.yaml` the
source of truth and fails CI when an implementation references a type the spec
doesn't declare, or the spec declares a type no implementation uses.

It deliberately uses anchored regexes (not a full parser) so it stays trivially
portable — no Go/Node/Swift toolchain, just Python 3 stdlib.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SPEC = ROOT / "spec" / "asyncapi.yaml"
ENGINE = ROOT / "engine" / "internal" / "api" / "messages.go"
IOS = ROOT / "ios-app" / "Sources"
TAURI = ROOT / "tauri-app" / "src"
TAURI_MESSAGES = TAURI / "types" / "engineMessages.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find(pattern: str, text: str) -> set[str]:
    return set(re.findall(pattern, text, flags=re.MULTILINE))


def read_sources(root: Path, suffixes: set[str]) -> str:
    chunks: list[str] = []
    for path in sorted(root.rglob("*")):
        if path.suffix in suffixes and "dist" not in path.parts:
            chunks.append(read(path))
    return "\n".join(chunks)


def spec_types() -> set[str]:
    # Channel message declarations: `      TYPE: { $ref: "#/components/messages/..." }`
    return find(r'^\s{6}([A-Z_]+):\s*\{\s*\$ref:\s*"#/components/messages/', read(SPEC))


def engine_types() -> set[str]:
    # `ActionX = "TYPE"` / `EventX = "TYPE"`
    return find(r'(?:Action|Event)\w+\s*=\s*"([A-Z_]+)"', read(ENGINE))


def ios_types() -> set[str]:
    text = read_sources(IOS, {".swift"})
    # Outgoing `type: "TYPE"` and incoming `case "TYPE"`.
    return (
        find(r'type:\s*"([A-Z_]+)"', text)
        | find(r'case\s+"([A-Z_]+)"', text)
        | find(r'case\s+\w+\s*=\s*"([A-Z_]+)"', text)
    )


def tauri_types() -> set[str]:
    text = read_sources(TAURI, {".ts", ".tsx"})
    message_constants = read(TAURI_MESSAGES)
    # Outgoing `sendMessage("TYPE"` / `type: "TYPE"`, incoming `case "TYPE"`.
    return (
        find(r'sendMessage\(\s*"([A-Z_]+)"', text)
        | find(r'type:\s*"([A-Z_]+)"', text)
        | find(r'case\s+"([A-Z_]+)"', text)
        | find(r'\b[A-Z][A-Za-z0-9_]*:\s*"([A-Z_]+)"', message_constants)
    )


def main() -> int:
    spec = spec_types()
    impls = {
        "engine (messages.go)": engine_types(),
        "iOS (Sources/*.swift)": ios_types(),
        "tauri (src messages)": tauri_types(),
    }

    if not spec:
        print("error: no message types extracted from spec — extraction broke", file=sys.stderr)
        return 2

    problems: list[str] = []

    # 1. Every type an implementation uses must be declared in the spec.
    for name, types in impls.items():
        undeclared = sorted(types - spec)
        if undeclared:
            problems.append(
                f"{name} references type(s) absent from spec/asyncapi.yaml: "
                + ", ".join(undeclared)
            )

    # 2. Every type the spec declares must be used by at least one implementation.
    used = set().union(*impls.values())
    unused = sorted(spec - used)
    if unused:
        problems.append(
            "spec/asyncapi.yaml declares type(s) no implementation uses: "
            + ", ".join(unused)
        )

    if problems:
        print("Protocol conformance FAILED:\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\nReconcile the type strings — update spec/asyncapi.yaml or the "
            "implementation so the protocol stays a single source of truth.",
            file=sys.stderr,
        )
        return 1

    print(f"Protocol conformance OK — {len(spec)} message types consistent across spec + 3 implementations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
