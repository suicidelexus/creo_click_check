# Deploy

The service lives in two places:

| Where | URL | Who can open it | How it updates |
|---|---|---|---|
| Render | https://creo-click-check.onrender.com | anyone on the internet (not reachable through the corporate VPN) | automatically on push to `main` |
| Internal server `10.83.24.22` | http://10.83.24.22:8091 | office network and Cisco AnyConnect only | `bash deploy/deploy.sh` |

## Internal copy

```bash
git push origin main      # Render picks it up by itself
bash deploy/deploy.sh     # internal copy: ships the committed main, not the working tree
```

The script ships `git archive main`, runs `npm ci --omit=dev`, installs the systemd unit and nginx site from this folder, restarts the service and checks that `:8091` answers. The previous release is kept in `/opt/creo-click-check/app.prev`.

- App: `/opt/creo-click-check/app`, system user `creo`, Node on `127.0.0.1:3091`, nginx on `:8091`.
- Logs: `sudo journalctl -u creo-click-check -f`.
- Rollback: `sudo mv /opt/creo-click-check/app /opt/creo-click-check/app.bad && sudo mv /opt/creo-click-check/app.prev /opt/creo-click-check/app && sudo systemctl restart creo-click-check`.
