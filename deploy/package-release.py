#!/usr/bin/env python3
"""Package only versioned deployment configuration, never runtime credentials."""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tarfile
import tempfile

from deploy import CONFIG_FILES, DeployError, unpack_release


def main():
    mode, revision, value, output = sys.argv[1:]
    directory = Path(output)
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise DeployError("Expected full commit SHA")
    if mode == "create":
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
            raise DeployError("Expected registry digest")
        files = {name: (Path(__file__).parent / name).read_bytes() for name in CONFIG_FILES}
        manifest = {"revision": revision, "image": "ghcr.io/woyaofei303/streamlab@" + value,
                    "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        files["manifest.json"] = json.dumps(manifest, sort_keys=True).encode()
        directory.mkdir(parents=True, exist_ok=True)
        with tarfile.open(directory / "release.tgz", "w:gz") as archive:
            for name, data in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o600
                archive.addfile(entry, io.BytesIO(data))
        checksum = hashlib.sha256((directory / "release.tgz").read_bytes()).hexdigest()
        (directory / "release.json").write_text(json.dumps({**manifest, "checksum": checksum}, indent=2) + "\n")
    elif mode == "verify":
        metadata = json.loads((directory / "release.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            release = unpack_release(Path(temporary), (directory / "release.tgz").read_bytes(), revision, metadata["checksum"])
            if json.loads((release / "manifest.json").read_text())["image"] != metadata["image"]:
                raise DeployError("Image metadata mismatch")
        print(metadata["checksum"])
    else:
        raise DeployError("Use create or verify")


if __name__ == "__main__":
    main()
