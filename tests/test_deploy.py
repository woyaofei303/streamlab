import importlib.util
from pathlib import Path
import json
import hashlib
import io
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).parents[1] / "deploy/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class LiveProtectionTest(unittest.TestCase):
    def test_active_stream_or_call_blocks_deployment(self):
        for name in ("live", "browser", "rtc", "call/guest"):
            with self.subTest(name=name), self.assertRaisesRegex(deploy.DeployError, "直播"):
                deploy.require_idle(lambda url: {"items": [{"name": name, "ready": True}]})
        with self.assertRaisesRegex(deploy.DeployError, "连麦"):
            deploy.require_idle(lambda url: {"items": []} if ":9997" in url else {"enabled": True, "participants": []})

    def test_unknown_status_fails_closed_and_idle_is_allowed(self):
        with self.assertRaises(deploy.DeployError):
            deploy.require_idle(lambda url: {})
        deploy.require_idle(lambda url: {"items": []} if ":9997" in url else {"enabled": False, "participants": []})


class FakeHost:
    def __init__(self):
        self.updated = []
        self.revision = "a" * 40
        self.bad_revision = None
        self.pull_fails = False
        self.live = False

    def run(self, args, env=None):
        if "config" in args:
            config = json.loads(Path(args[args.index("-f") + 1]).read_text())
            config["services"]["web"]["image"] = env["WEB_IMAGE"]
            return json.dumps(config)
        if "pull" in args and self.pull_fails:
            raise deploy.DeployError("download failed")
        if "up" in args:
            services = args[args.index("--force-recreate") + 1:]
            self.updated.append(services)
            self.revision = env["APP_REVISION"]
        if "inspect" in args:
            return "true"
        return ""

    def read(self, url):
        if ":9997" in url:
            return {"items": [{"name": "live", "ready": self.live}]}
        if url.endswith("/api/calls"):
            return {"enabled": False, "participants": []}
        if url.endswith("/api/health"):
            return {"status": "error" if self.revision == self.bad_revision else "ok", "revision": self.revision}
        return {"online": True}


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "shared/config").mkdir(parents=True)
        (self.root / "shared/runtime.env").write_text("DOMAIN=live.example.com\n")
        self.host = FakeHost()
        self.manager = deploy.Deployment(self.root, run=self.host.run, read=self.host.read, attempts=1)
        self.old = self.release("a")
        self.new = self.release("b")
        self.manager.write_state({"current": self.old.name, "previous": None, "history": [self.old.name]})
        self.manager.install_config(self.old)

    def release(self, letter):
        revision = letter * 40
        release = self.root / "releases" / (revision + "-" + letter * 12)
        release.mkdir(parents=True)
        (release / "manifest.json").write_text(json.dumps({"revision": revision, "image": "ghcr.io/woyaofei303/streamlab@sha256:" + letter * 64}))
        (release / "compose.yml").write_text(json.dumps({"name": "streamlab", "services": {
            "web": {"image": "${WEB_IMAGE}"},
            "media": {"image": "bluenviron/mediamtx:1.21.1"},
            "proxy": {"image": "caddy:2-alpine", "environment": {"DOMAIN": "live.example.com"}},
        }}))
        (release / "Caddyfile").write_text("caddy config")
        (release / "mediamtx.yml").write_text("media config")
        return release

    def test_web_release_and_manual_rollback_only_restart_web(self):
        self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [["web"]])
        self.assertEqual(self.manager.state()["current"], self.new.name)
        self.manager.rollback()
        self.assertEqual(self.host.updated, [["web"], ["web"]])
        self.assertEqual(self.manager.state()["current"], self.old.name)

    def test_failed_readiness_restores_images_and_configuration(self):
        (self.new / "mediamtx.yml").write_text("new media config")
        self.host.bad_revision = "b" * 40
        with self.assertRaisesRegex(deploy.DeployError, "ROLLED_BACK"):
            self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [["media", "web"], ["media", "web"]])
        self.assertEqual((self.root / "shared/config/mediamtx.yml").read_text(), "media config")
        self.assertEqual(self.host.revision, "a" * 40)
        self.assertEqual(self.manager.state()["current"], self.old.name)

    def test_download_failure_or_live_input_preserves_old_release(self):
        for failure in ("pull_fails", "live"):
            with self.subTest(failure=failure):
                setattr(self.host, failure, True)
                with self.assertRaises(deploy.DeployError):
                    self.manager.apply(self.new)
                setattr(self.host, failure, False)
                self.assertEqual(self.host.updated, [])
                self.assertEqual(self.manager.state()["current"], self.old.name)

    def test_config_only_change_updates_only_affected_service(self):
        (self.new / "manifest.json").write_bytes((self.old / "manifest.json").read_bytes())
        (self.new / "Caddyfile").write_text("new proxy config")
        self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [["proxy"]])

    def test_live_input_started_during_download_blocks_switch(self):
        original = self.host.run
        def start_stream(args, env=None):
            result = original(args, env)
            if "pull" in args:
                self.host.live = True
            return result
        self.manager.run = start_stream
        with self.assertRaises(deploy.DeployError):
            self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [])

    def test_invalid_configuration_does_not_restart_services(self):
        (self.new / "Caddyfile").write_text("broken")
        original = self.host.run
        def reject_config(args, env=None):
            if "validate" in args:
                raise deploy.DeployError("Invalid config")
            return original(args, env)
        self.manager.run = reject_config
        with self.assertRaises(deploy.DeployError):
            self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [])
        self.assertEqual((self.root / "shared/config/Caddyfile").read_text(), "caddy config")

    def test_concurrent_release_is_rejected(self):
        with deploy.deployment_lock(self.root):
            with self.assertRaisesRegex(deploy.DeployError, "deployment is running"):
                with deploy.deployment_lock(self.root):
                    self.fail("second deployment acquired lock")

    def test_start_failure_restores_previous_release(self):
        original = self.host.run
        def fail_start(args, env=None):
            if "up" in args and env["APP_REVISION"] == "b" * 40:
                raise deploy.DeployError("container could not start")
            return original(args, env)
        self.manager.run = fail_start
        with self.assertRaisesRegex(deploy.DeployError, "ROLLED_BACK"):
            self.manager.apply(self.new)
        self.assertEqual(self.host.updated, [["web"]])
        self.assertEqual(self.manager.state()["current"], self.old.name)
        self.assertFalse((self.root / "pending.json").exists())

    def test_failed_rollback_keeps_journal_and_recovery_restores_state(self):
        original = self.host.run
        self.host.bad_revision = "b" * 40
        def fail_rollback(args, env=None):
            if "up" in args and env["APP_REVISION"] == "a" * 40:
                raise deploy.DeployError("rollback failed")
            return original(args, env)
        self.manager.run = fail_rollback
        with self.assertRaisesRegex(deploy.DeployError, "ROLLBACK_FAILED"):
            self.manager.apply(self.new)
        self.assertTrue((self.root / "pending.json").exists())
        with self.assertRaisesRegex(deploy.DeployError, "Unfinished deployment"):
            self.manager.apply(self.new)
        self.manager.run = original
        self.manager.recover()
        self.assertEqual(self.manager.state()["current"], self.old.name)
        self.assertEqual(self.host.revision, "a" * 40)
        self.assertFalse((self.root / "pending.json").exists())

    def test_same_release_does_not_restart_and_retention_preserves_bootstrap(self):
        self.manager.apply(self.old)
        self.assertEqual(self.host.updated, [])
        bootstrap = self.root / "releases/bootstrap"
        bootstrap.mkdir()
        (bootstrap / "manifest.json").write_bytes((self.old / "manifest.json").read_bytes())
        backup = self.root / "backups/initial"
        backup.mkdir(parents=True)
        for letter in "bcd":
            release = self.new if letter == "b" else self.release(letter)
            self.manager.apply(release)
        self.manager.prune()
        self.assertFalse(self.old.exists())
        self.assertTrue(bootstrap.exists())
        self.assertTrue(backup.exists())
        self.assertTrue(self.new.exists())
        self.assertEqual(len(self.manager.state()["history"]), 3)


class BundleTest(unittest.TestCase):
    def bundle(self, extra=None):
        files = {"compose.yml": b"compose", "Caddyfile": b"proxy", "mediamtx.yml": b"media"}
        manifest = {"revision": "b" * 40, "image": "ghcr.io/woyaofei303/streamlab@sha256:" + "c" * 64,
                    "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        files["manifest.json"] = json.dumps(manifest).encode()
        if extra:
            files.update(extra)
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        return output.getvalue()

    def test_bundle_is_verified_before_writing_release(self):
        with tempfile.TemporaryDirectory() as root:
            payload = self.bundle()
            release = deploy.unpack_release(Path(root), payload, "b" * 40, hashlib.sha256(payload).hexdigest())
            self.assertEqual((release / "Caddyfile").read_text(), "proxy")
            for data, checksum in ((payload, "a" * 64), (self.bundle({"../secret": b"bad"}), None)):
                with self.assertRaises(deploy.DeployError):
                    deploy.unpack_release(Path(root), data, "b" * 40, checksum or hashlib.sha256(data).hexdigest())


if __name__ == "__main__":
    unittest.main()
