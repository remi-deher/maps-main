#!/usr/bin/env python3
import json
import sys
from pathlib import Path
import yaml
import jsonschema

ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "asyncapi.yaml"
FIXTURES_DIR = ROOT / "fixtures"

def main():
    if not FIXTURES_DIR.exists():
        print(f"Fixtures directory not found: {FIXTURES_DIR}")
        return 1

    with open(SPEC, "r", encoding="utf-8") as f:
        spec = yaml.safe_load(f)

    # Extract all message payload schemas
    message_schemas = {}
    for msg_name, msg_def in spec.get("components", {}).get("messages", {}).items():
        if "payload" in msg_def:
            message_schemas[msg_name] = msg_def["payload"]

    success = True
    tested_count = 0

    for fixture_path in FIXTURES_DIR.glob("*.json"):
        msg_name = fixture_path.stem
        if msg_name not in message_schemas:
            print(f"WARNING: No schema found for {msg_name} in asyncapi.yaml")
            continue

        with open(fixture_path, "r", encoding="utf-8") as f:
            try:
                payload = json.load(f)
            except json.JSONDecodeError as e:
                print(f"FAIL: {fixture_path.name} is invalid JSON - {e}")
                success = False
                continue

        # We construct a wrapper schema for this specific message, embedding components
        # so that jsonschema can resolve $ref links like "#/components/schemas/..."
        test_schema = {
            **message_schemas[msg_name],
            "components": spec.get("components", {})
        }

        try:
            jsonschema.validate(instance=payload, schema=test_schema)
            print(f"PASS: {fixture_path.name}")
            tested_count += 1
        except jsonschema.exceptions.ValidationError as e:
            print(f"FAIL: {fixture_path.name} failed validation!")
            path_str = ' -> '.join(str(p) for p in e.absolute_path)
            print(f"  Path: {path_str}")
            print(f"  Error: {e.message}")
            success = False

    if tested_count == 0:
        print("WARNING: No fixtures found to test.")
        
    if success and tested_count > 0:
        print(f"Contract tests OK — {tested_count} payloads validated.")
        
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
