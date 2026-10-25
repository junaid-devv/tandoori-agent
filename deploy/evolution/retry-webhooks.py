#!/usr/bin/env python3
"""Systemd timer entry point. Its private JSON config stays outside Git."""
import json
import urllib.request
from pathlib import Path

config = json.loads(Path("/home/azureuser/evolution-api/webhook-worker.json").read_text())
request = urllib.request.Request(
    config["url"], data=b"{}", method="POST",
    headers={"Content-Type": "application/json", "x-worker-key": config["key"]},
)
with urllib.request.urlopen(request, timeout=58) as response:
    result = json.load(response)
    if result.get("retried"):
        print("Recovered webhook dispatch:", result["retried"])
