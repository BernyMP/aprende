# Remote access

Connect a browser or another desktop app to aprende running on a different
machine. That machine must stay running and reachable while you work.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On the host, choose the local network in `aprende up`, or run:

```bash
aprende up --lan
```

For a server in a terminal, run `aprende serve --lan`. Either way, aprende then
accepts connections from your local network and tailnet, so a pairing code is
all that keeps other devices on them out.

If a server is already running, generate a fresh link without restarting it:

```bash
aprende pair
```

Open the printed pairing URL in a browser on the other device. A loopback
address such as `127.0.0.1` reaches only the device opening the link.

On a computer with the desktop app, you can open the printed `aprende://pair`
app link instead. The desktop app asks you to confirm the server address, then
adds it.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect.

### Reach one machine several ways

A machine can have more than one route: LAN, Tailscale, another VPN, a public
URL, or SSH. Tailscale shares its `100.64.0.0/10` address range with
other VPNs such as Cloudflare WARP, so an address in that range shows as VPN
unless the machine confirms it is on Tailscale.
A pairing link for a saved machine is refused when it comes from an address
that machine does not have yet. Pairing again over an address the machine
already has still works.

While connected through a paired address, aprende also learns the
machine's current LAN and Tailscale addresses and adds them as routes, so
pairing once over Tailscale is enough to use the LAN at home. When the
machine's LAN address changes, for example after it joins another Wi-Fi network,
the learned route follows it. The machine must allow network access for its LAN
address to be learned: the
[local network](./background-service.md#local-network-access) choice in `aprende up`.
A learned route goes away with the route it was learned through, or when the
machine stops reporting that address.

aprende connects over the first route that answers. Away from home, a LAN
address that does not answer is checked briefly and skipped. It is only tried
again, after the other routes, if none of them connect. While connected over a
later route, aprende checks the earlier ones when your network changes, when you
return to the app, and every minute, and moves back as soon as one works.

## Connect an outside agent

Claude Code, Codex, ChatGPT and other agents aprende did not start can drive
threads on an environment through its MCP server. See
[outside agents](./outside-agents.md) for setup.

## Manage or revoke access

Manage access from the command line on the host. `aprende auth pairing create`
creates a pairing link, `aprende auth pairing list` shows unused ones, and
`aprende auth pairing revoke <id>` prevents new pairings with one. To remove a
device's existing access, find its session with `aprende auth session list` and
run `aprende auth session revoke <session-id>`. `aprende auth --help` lists every
command.

A session with an open connection stays listed after its access credential
expires.

To choose a token's permissions, pass `--scope` once for each scope you want:

```sh
npx aprende pair --scope orchestration:read --scope filesystem:read
```

The selected scopes replace the default permissions. The same option works with
`npx aprende auth pairing create` and `npx aprende auth session issue`; each command's
`--help` lists the available scopes. Without `--scope`, pairing tokens and issued
bearer sessions get every permission, including managing access. A full-access
agent on the host can reach that as well, so a client that should not manage
access also needs to go without `orchestration:operate`.

To change an existing client's permissions, create a fresh pairing link with the
scopes it needs. In a browser opened directly on the environment, open that link
to replace the browser's current grant. For a saved remote environment in the
desktop app, open the fresh `aprende://pair` app link; pairing the same
environment replaces its saved grant. Reconnecting alone does not change
permissions.

Grouping checkouts does not combine their permissions. Shared project settings
require `orchestration:operate` on every member environment; actions on one
checkout use that checkout's permissions.

Settings changes, provider management, environment maintenance and access
management can each be granted separately. New
pairings without `--scope` include all of them. Existing clients keep the
permissions they paired with and can stay connected after an update, but newly
separated features may require pairing again with the permissions they need.
Older clients may show controls that the server denies. Create a fresh pairing
link to change a client's permissions.

`filesystem:read` allows browsing host files, opening workspace files, and viewing
local changes. Add `filesystem:write` to allow editing files or saving plans to
the workspace. These scopes control direct file access from the client.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.
