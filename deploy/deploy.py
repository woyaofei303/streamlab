#!/usr/bin/env python3
"""Single-host releases; only this root-owned entry point is allowed over deployment SSH."""
import fcntl
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid


class DeployError(Exception):
    pass


CONFIG_FILES = {"compose.yml", "Caddyfile", "mediamtx.yml"}
ROOT = Path("/home/admin/streamlab")


@contextmanager
def deployment_lock(root):
    with (root / ".deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DeployError("Another deployment is running") from error
        yield


def unpack_release(root, payload, revision, checksum):
    if len(payload) > 1024 * 1024 or hashlib.sha256(payload).hexdigest() != checksum:
        raise DeployError("Release bundle checksum/size mismatch")
    files = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            for member in archive:
                if (member.name not in CONFIG_FILES | {"manifest.json"} or member.name in files
                        or not member.isfile() or member.size > 65536):
                    raise DeployError("Unexpected release archive entry")
                files[member.name] = archive.extractfile(member).read()
        manifest = json.loads(files["manifest.json"])
        if (set(files) != CONFIG_FILES | {"manifest.json"} or manifest["revision"] != revision
                or not re.fullmatch(r"[0-9a-f]{40}", revision)
                or not re.fullmatch(r"ghcr\.io/woyaofei303/streamlab@sha256:[0-9a-f]{64}", manifest["image"])
                or manifest["files"] != {name: hashlib.sha256(files[name]).hexdigest() for name in CONFIG_FILES}):
            raise DeployError("Invalid release manifest or configuration checksum")
    except (KeyError, TypeError, ValueError, tarfile.TarError) as error:
        raise DeployError("Invalid release bundle") from error
    identifier = revision + "-" + hashlib.sha256(payload).hexdigest()[:12]
    releases = root / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    destination = releases / identifier
    if destination.exists():
        if any((destination / name).read_bytes() != data for name, data in files.items()):
            raise DeployError("Existing release cannot be overwritten")
        return destination
    with tempfile.TemporaryDirectory(dir=releases) as directory:
        staging = Path(directory)
        for name, data in files.items():
            (staging / name).write_bytes(data)
        staging.rename(destination)
    return destination


def run(args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=300)
    if result.returncode:
        # Compose diagnostics can contain expanded secrets; keep them off the public CI log.
        raise DeployError(f"Command failed ({result.returncode}): {' '.join(args[:2])}")
    return result.stdout.strip()


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def read_json(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def require_idle(read=read_json):
    try:
        paths = read("http://127.0.0.1:9997/v3/paths/list")["items"]
        if not isinstance(paths, list) or any(type(p.get("ready")) is not bool for p in paths):
            raise ValueError("Invalid media status")
        if any(p["ready"] for p in paths):
            raise DeployError("正在直播，未更新；停播后重新发布")
        calls = read("http://127.0.0.1:3000/api/calls")
        if type(calls.get("enabled")) is not bool or not isinstance(calls.get("participants"), list):
            raise ValueError("Invalid call status")
        if calls["enabled"] or calls["participants"]:
            raise DeployError("正在连麦，未更新；关闭连麦后重新发布")
    except DeployError:
        raise
    except Exception as error:
        raise DeployError("无法确认直播状态，未更新") from error


class Deployment:
    def __init__(self, root, run=run, read=read_json, attempts=18):
        self.root = Path(root)
        self.run = run
        self.read = read
        self.attempts = attempts

    def state(self):
        return json.loads((self.root / "state.json").read_text())

    def write_state(self, state):
        atomic_json(self.root / "state.json", state)

    def manifest(self, release):
        return json.loads((release / "manifest.json").read_text())

    def environment(self, release):
        manifest = self.manifest(release)
        return {**os.environ, "WEB_IMAGE": manifest["image"],
                "APP_REVISION": manifest["revision"],
                "STREAMLAB_CONFIG_DIR": str(self.root / "shared/config")}

    def compose(self, release, *args):
        return self.run(["docker", "compose", "--project-name", "streamlab", "--env-file",
                         str(self.root / "shared/runtime.env"), "-f", str(release / "compose.yml"), *args],
                        env=self.environment(release))

    def config(self, release):
        config = json.loads(self.compose(release, "config", "--format", "json"))
        if set(config["services"]) != {"web", "media", "proxy"} or config.get("name") != "streamlab":
            raise DeployError("Unexpected Compose project or services")
        return config

    def install_config(self, release):
        for name in ("Caddyfile", "mediamtx.yml"):
            target = self.root / "shared/config" / name
            if not target.exists() or target.read_bytes() != (release / name).read_bytes():
                temporary = target.with_suffix(".tmp")
                shutil.copyfile(release / name, temporary)
                temporary.replace(target)

    def changed(self, old, new):
        before, after = self.config(old), self.config(new)
        changed = {name for name in after["services"] if before["services"][name] != after["services"][name]}
        for name, service in (("Caddyfile", "proxy"), ("mediamtx.yml", "media")):
            if (old / name).read_bytes() != (new / name).read_bytes():
                changed.add(service)
        return [name for name in ("media", "web", "proxy") if name in changed]

    def validate(self, release, services):
        config = self.config(release)["services"]
        if "proxy" in services:
            self.run(["docker", "run", "--rm", "--network", "none", "-e", "DOMAIN",
                      "-v", f"{release / 'Caddyfile'}:/etc/caddy/Caddyfile:ro",
                      config["proxy"]["image"], "caddy", "validate", "--config", "/etc/caddy/Caddyfile"],
                     env={**os.environ, "DOMAIN": config["proxy"]["environment"]["DOMAIN"]})
        if "media" in services:
            name = "streamlab-config-check-" + uuid.uuid4().hex
            environment = config["media"].get("environment", {})
            arguments = [arg for key in environment for arg in ("-e", key)]
            try:
                self.run(["docker", "run", "--detach", "--name", name, "--network", "none", *arguments,
                          "-v", f"{release / 'mediamtx.yml'}:/mediamtx.yml:ro", config["media"]["image"]],
                         env={**os.environ, **environment})
                time.sleep(1)
                if self.run(["docker", "inspect", "--format", "{{.State.Running}}", name]) != "true":
                    raise DeployError("MediaMTX configuration validation failed")
            finally:
                self.run(["docker", "rm", "-f", name])

    def healthy(self, release):
        revision = self.manifest(release)["revision"]
        domain = self.config(release)["services"]["proxy"]["environment"]["DOMAIN"]
        for attempt in range(self.attempts):
            try:
                for base in ("http://127.0.0.1:3000", f"https://{domain}"):
                    if revision == "bootstrap":
                        if self.read(base + "/api/media/status").get("online") is not True:
                            raise ValueError("Media unavailable")
                        self.read(base + "/api/calls")
                    else:
                        result = self.read(base + "/api/health")
                        if result.get("status") != "ok" or result.get("revision") != revision:
                            raise ValueError("Readiness or revision mismatch")
                return
            except Exception:
                if attempt + 1 < self.attempts:
                    time.sleep(5)
        raise DeployError("Readiness failed (local/public HTTPS/revision)")

    def apply(self, release):
        if (self.root / "pending.json").exists():
            raise DeployError("Unfinished deployment; administrator must run streamlab-deploy recover")
        require_idle(self.read)
        state = self.state()
        old = self.root / "releases" / state["current"]
        services = self.changed(old, release)
        if not services:
            self.healthy(release)
            print("Already deployed", flush=True)
            return
        if self.manifest(release)["revision"] != "bootstrap":
            self.compose(release, "pull", *services)
        else:
            for service in services:
                self.run(["docker", "image", "inspect", self.config(release)["services"][service]["image"]])
        self.validate(release, services)
        require_idle(self.read)
        journal = self.root / "pending.json"
        atomic_json(journal, {"from": old.name, "to": release.name, "services": services, "state": state})
        try:
            self.install_config(release)
            self.compose(release, "up", "-d", "--no-build", "--no-deps", "--force-recreate", *services)
            self.healthy(release)
            self.write_state({"current": release.name, "previous": old.name,
                              "history": list(dict.fromkeys([release.name, *state["history"]]))[:3]})
        except BaseException as error:
            try:
                self.restore(old, services)
                self.write_state(state)
            except BaseException as rollback_error:
                raise DeployError("ROLLBACK_FAILED; run as administrator: streamlab-deploy recover") from rollback_error
            journal.unlink()
            raise DeployError("DEPLOY_FAILED_ROLLED_BACK; previous version is healthy") from error
        journal.unlink()
        print(f"DEPLOY_OK revision={self.manifest(release)['revision']} services={','.join(services)} health=local,https rollback=not-needed", flush=True)

    def restore(self, release, services):
        self.install_config(release)
        self.compose(release, "up", "-d", "--no-build", "--no-deps", "--force-recreate", *services)
        self.healthy(release)

    def recover(self):
        pending = self.root / "pending.json"
        operation = json.loads(pending.read_text())
        self.restore(self.root / "releases" / operation["from"], operation["services"])
        self.write_state(operation["state"])
        pending.unlink()
        print("RECOVERED previous version", flush=True)

    def rollback(self):
        previous = self.state().get("previous")
        if not previous:
            raise DeployError("No previous successful release")
        self.apply(self.root / "releases" / previous)

    def prune(self):
        state = self.state()
        protected = set(state["history"]) | {state["current"], state.get("previous"), "bootstrap"}
        retained_images = {self.manifest(self.root / "releases" / name)["image"] for name in protected if name}
        for release in (self.root / "releases").iterdir():
            if release.name in protected or release.is_symlink() or not re.fullmatch(r"[a-f0-9]{40}-[a-f0-9]{12}", release.name):
                continue
            image = self.manifest(release)["image"]
            shutil.rmtree(release)
            if image not in retained_images:
                try:
                    self.run(["docker", "image", "rm", image])
                except DeployError:
                    print("Retention: unused image cleanup skipped", flush=True)

    def bootstrap(self):
        if (self.root / "state.json").exists():
            raise DeployError("Already initialized; bootstrap does not overwrite existing state")
        require_idle(self.read)
        source = self.root / "deploy"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = self.root / "backups" / stamp
        backup.mkdir(parents=True, mode=0o700)
        self.run(["tar", "-czf", str(backup / "source.tar.gz"),
                  *[f"--exclude=./{name}" for name in ("node_modules", ".next", ".git", "output-tdd", "docs-tdd", "backups", "releases", "shared", "media/recordings")],
                  "-C", str(self.root), "."])
        shared = self.root / "shared/config"
        shared.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / ".env", self.root / "shared/runtime.env")
        os.chmod(self.root / "shared/runtime.env", 0o600)
        config = json.loads(self.run(["docker", "compose", "--project-name", "streamlab", "--env-file",
                                      str(source / ".env"), "-f", str(source / "compose.yml"), "config", "--format", "json"]))
        release = self.root / "releases/bootstrap"
        release.mkdir(parents=True, exist_ok=True)
        for service, settings in config["services"].items():
            image = self.run(["docker", "inspect", "--format", "{{.Image}}", f"streamlab-{service}-1"])
            tag = f"streamlab-bootstrap-{service}:{stamp}"
            self.run(["docker", "tag", image, tag])
            settings.pop("build", None)
            settings["image"] = tag
            for key in settings.get("environment", {}):
                if key == "PUBLISH_PASSWORD" or key == "MTX_AUTHINTERNALUSERS_0_PASS":
                    settings["environment"][key] = "${PUBLISH_PASSWORD:?Set PUBLISH_PASSWORD}"
            for volume in settings.get("volumes", []):
                if volume["type"] == "bind" and volume["target"] in ("/mediamtx.yml", "/etc/caddy/Caddyfile"):
                    volume["source"] = str(shared / Path(volume["source"]).name)
        atomic_json(release / "compose.yml", config)
        atomic_json(release / "manifest.json", {"revision": "bootstrap", "image": config["services"]["web"]["image"]})
        for name in ("Caddyfile", "mediamtx.yml"):
            shutil.copyfile(source / name, release / name)
        self.install_config(release)
        self.write_state({"current": "bootstrap", "previous": None, "history": ["bootstrap"]})
        print(f"BOOTSTRAP_OK backup={backup}; running containers unchanged", flush=True)


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise DeployError("Use the installed root-owned deployment entry point")
    command = sys.argv[1]
    match = re.fullmatch(r"deploy ([a-f0-9]{40}) ([a-f0-9]{64})", command)
    if not match and command not in ("bootstrap", "rollback", "recover"):
        raise DeployError("Invalid deployment command")
    if not ROOT.is_dir():
        raise DeployError("Existing StreamLab directory is missing")
    with deployment_lock(ROOT):
        if (match or command == "bootstrap") and shutil.disk_usage(ROOT).free < 2 * 1024**3:
            raise DeployError("Less than 2 GiB available; no changes made")
        logs = ROOT / "logs"
        logs.mkdir(exist_ok=True)
        manager = Deployment(ROOT)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        def interrupted(signum, _frame):
            raise DeployError(f"Deployment interrupted ({signum})")
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        outcome = "failed"
        try:
            if match:
                require_idle()
                revision, checksum = match.groups()
                payload = sys.stdin.buffer.read(1024 * 1024 + 1)
                release = unpack_release(ROOT, payload, revision, checksum)
                manager.apply(release)
            else:
                getattr(manager, command)()
            outcome = "success"
            if command in ("rollback",) or match:
                try:
                    manager.prune()
                except Exception:
                    print("Retention cleanup skipped; active release preserved", flush=True)
        finally:
            with (logs / "deployments.jsonl").open("a") as log:
                log.write(json.dumps({"started": started, "command": command, "outcome": outcome}) + "\n")


if __name__ == "__main__":
    try:
        main()
    except DeployError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f"Deployment stopped: {type(error).__name__}; inspect server state and pending.json", file=sys.stderr)
        sys.exit(1)
