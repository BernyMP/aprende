# Remote access

Connect a phone, browser, or another desktop app to aprende running on a different
machine. That machine must stay running and reachable while you work.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Sharing & access**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, choose the local network in `aprende up`, or run:

```bash
t3 up --lan
```

For a server in a terminal, run `aprende serve --lan`. Either way, aprende then
accepts connections from your local network and tailnet, so a pairing code is
all that keeps other devices on them out.

If a server is already running, generate a fresh link without restarting it:

```bash
t3 pair
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Environments**
on web and desktop and **Settings → Environments** on mobile. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

On a computer with the desktop app, you can open the printed `aprende://pair`
app link instead. The desktop app asks you to confirm the server address, then
adds it.

If your HTTPS endpoint uses a certificate from your own certificate authority,
install that CA on Android as a **CA certificate** in its security settings; the
Android app then trusts it.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Sharing & access page stays open. If you leave or reload that page, create
another link to share.

### Reach one machine several ways

A machine can have more than one route: LAN, Tailscale, another VPN, a public
URL, SSH, or T3 Connect. Tailscale shares its `100.64.0.0/10` address range with
other VPNs such as Cloudflare WARP, so an address in that range shows as VPN
unless the machine confirms it is on Tailscale. To add a route, choose **Add
route** in the machine's route list, or next to it in the T3 Connect list.
A pairing link for a saved machine is refused when it comes from an address
that machine does not have yet; add that address with **Add route** instead.
Pairing again over an address the machine already has still works. A new route
is placed by speed, in that order, and you can reorder routes at any time.

While connected through T3 Connect or a paired address, aprende also learns the
machine's current LAN and Tailscale addresses and adds them as routes, so
pairing once through T3 Connect is enough to use the LAN at home. When the
machine's LAN address changes, for example after it joins another Wi-Fi network,
the learned route follows it. The machine must allow network access for its LAN
address to be learned: **Network access** in the desktop app, or the
[local network](./background-service.md#local-network-access) choice in `aprende up`.
You can reorder a learned route, but not remove it; it
goes away with the route it was learned through, or when the machine stops
reporting that address.

aprende connects over the first route that answers. Away from home, a LAN
address that does not answer is checked briefly and skipped. It is only tried
again, after the other routes, if none of them connect. While connected over a
later route, aprende checks the earlier ones when your network changes, when you
return to the app, and every minute, and moves back as soon as one works.

On web and desktop, select the route count under the machine's name in
**Settings → Environments** to see its routes. Drag a route to change the order,
or remove it. On mobile, open the machine under **Settings → Environments** and
choose **Edit**. Signing out of T3 Connect removes only that route; a machine
you can still reach another way stays saved.

Open **Permissions** next to **Routes** in web or desktop, or **Your permissions**
in the mobile route details, to see what your current connection can do on that
environment. For a remote environment, this is in its route details. Permissions
shown there apply only to the route marked **In use**; other routes are not
checked. Direct pairing and T3 Connect have separate sessions and may grant
different permissions.

### Balance new threads across machines

Auto balance is off by default. On web and desktop, enable it in
**Settings → Environments → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments. The section
appears once two or more machines are switched on.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. If resource checks are
unavailable or all eligible machines are full, choose a machine manually to continue.
Mobile keeps its manual environment selection.

## Connect an outside agent

Claude Code, Codex, ChatGPT and other agents aprende did not start can drive
threads on an environment through its MCP server. See
[outside agents](./outside-agents.md) for setup.

## Manage or revoke access

On the host, **Settings → Sharing & access** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `aprende auth --help`.

When the app connects to more than one environment, choose one at the top of the
page. A desktop app with **Local environment** off can manage a background
service on the same machine this way.

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
to replace the browser's current grant. For mobile or a saved remote environment
in web or desktop, use **Add Environment** with the fresh link or code; pairing
the same environment replaces its saved grant. Reconnecting alone does not change
permissions.

Grouping checkouts does not combine their permissions. Shared project settings
require `orchestration:operate` on every member environment; actions on one
checkout use that checkout's permissions.

`source-control:write` covers direct Git changes made from the
client: pulling, switching or creating branches, and removing
worktrees. It does not restrict what a task does. Starting a task in a new
worktree still creates that branch and worktree with `orchestration:operate`,
and the agent it runs can use Git however the environment allows.

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

## Using the Desktop App as a Remote Only

If a computer should only drive work running elsewhere, turn off its local environment. In the
desktop app, open **Settings → Environments** and switch off **Local
environment**. aprende restarts without a local server: no local agents or terminals run, WSL
backends stay off, and other devices can no longer connect to this computer. Your projects,
history, and saved connections are kept, and you keep working through pairing, T3 Connect, or SSH.

Switch **Local environment** back on in the same place to restart with your previous local
settings.
