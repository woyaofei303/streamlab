#!/bin/bash
# Run once as root on the existing server; argument is the dedicated PUBLIC key file.
set -euo pipefail
test "$(id -u)" = 0
test "$#" = 1
test "$(uname -m)" = x86_64
for command in python3 docker ssh-keygen visudo useradd; do command -v "$command" >/dev/null; done
docker compose version >/dev/null
test -f "$1"
ssh-keygen -l -f "$1" >/dev/null
test "$(wc -l < "$1" | tr -d ' ')" = 1
grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$1"
task_dir=$(cd -- "$(dirname -- "$0")" && pwd)
test ! -e /usr/local/lib/streamlab/deploy.py
if id streamlab-deploy >/dev/null 2>&1 || test -e /home/streamlab-deploy || test -e /etc/sudoers.d/streamlab-deploy; then
  echo 'Deployment account already exists; inspect it before initialization.' >&2
  exit 1
fi
python3 "$task_dir/deploy.py" bootstrap
install -d -m 755 /usr/local/lib/streamlab
install -m 755 "$task_dir/deploy.py" /usr/local/lib/streamlab/deploy.py
useradd --system --create-home --shell /bin/sh streamlab-deploy
install -d -o root -g root -m 755 /home/streamlab-deploy /home/streamlab-deploy/.ssh
{ printf 'restrict,command="/usr/local/bin/streamlab-ssh" '; cat "$1"; } > /home/streamlab-deploy/.ssh/authorized_keys
chmod 644 /home/streamlab-deploy/.ssh/authorized_keys
cat > /usr/local/bin/streamlab-ssh <<'SH'
#!/bin/sh
case "${SSH_ORIGINAL_COMMAND:-}" in
  rollback|deploy\ *) exec sudo -n /usr/bin/python3 /usr/local/lib/streamlab/deploy.py "$SSH_ORIGINAL_COMMAND" ;;
  *) echo 'Only deploy and rollback are allowed' >&2; exit 1 ;;
esac
SH
cat > /usr/local/bin/streamlab-deploy <<'SH'
#!/bin/sh
exec /usr/bin/python3 /usr/local/lib/streamlab/deploy.py "$*"
SH
chmod 755 /usr/local/bin/streamlab-ssh /usr/local/bin/streamlab-deploy
printf '%s\n' 'streamlab-deploy ALL=(root) NOPASSWD: /usr/bin/python3 /usr/local/lib/streamlab/deploy.py *' > /etc/sudoers.d/streamlab-deploy
chmod 440 /etc/sudoers.d/streamlab-deploy
visudo -cf /etc/sudoers.d/streamlab-deploy
cat > /etc/logrotate.d/streamlab-deploy <<'LOG'
/home/admin/streamlab/logs/deployments.jsonl {
  size 1M
  rotate 3
  compress
  missingok
  notifempty
  copytruncate
}
LOG
printf '%s\n' 'Initialization complete. Running services have not been restarted.'
