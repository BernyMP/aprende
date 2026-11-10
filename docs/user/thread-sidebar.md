# Working with threads

Use a new thread for a separate task.

## Start a thread

On web and desktop, **New lesson** opens the project picker when you have multiple
projects in the default or project-grouped sidebar. The legacy sidebar always
starts in the current project. **Shift-click** to start in
the current project, or use a project's own new-thread action. A new thread carries
your model and mode selections, unless the destination project has its own model default.

On mobile, **New lesson** starts in the current thread's project, or else in the
last project you opened or chose on that device. If neither is available, the
project picker opens. Turn off **Settings → General → Use last project** to
choose a project every time. When you pick a project that is on more than one
machine, the thread starts on a connected one if any is connected.

When you change a new thread's project, aprende stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Start without a project

A thread does not need a project. To start one without a project, click **or
just ask a quick question** under a new thread's heading, pick **Quick questions** from
the project menu in that heading or from **New lesson in...** in the command
palette, or press `mod+alt+n`. On mobile, pick **Quick questions** from the project
list. It starts on your current machine; before sending, pick another machine
from the machine menu to move it there. To move a draft into a project, pick the
project in the heading.

Each thread without a project works in its own folder under `~/.aprende/scratch` (the
`scratch` folder of your T3 data directory), named after its date, the first words
of its first message, and a short id, like
`2026-09-25-convert-these-pngs-to-webp-a1b2c3d4`. Deleting a thread keeps its
folder, so the files the agent wrote stay until you delete them.

When the work grows into something real, pick **Turn into project** from the
thread's menu. The thread's folder becomes a project where it is, so nothing
moves and the agent keeps working in the same place. Other threads in that folder
move with it. Rename the project in its settings.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

On web and desktop, unpinning, settling, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. Discarding an unsent draft from the sidebar works the same way: Undo brings
back its text and attachments. `mod+z` triggers the most recent Undo, even from the composer; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Settle**, **Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed settled shelf.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. On
mobile, open a thread's menu and choose **Arrange threads**. Drag a handle within or between
**Pinned** and **Active** to reorder, pin, or unpin. Drop onto the **Settled** divider to
settle a thread. The dragged card shows the action before you release it. Expand **Snoozed**
or **Settled** to drag a parked thread back into either live section. Each drop saves; close the sheet to return to the thread list.
**Move up** and **Move down** are also available in the thread menu. The server
saves the order, so it survives a refresh and appears on your other connected devices.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Settle**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

New threads appear above the active threads you have arranged. Settling clears a thread's active
position, so using **Un-settle** returns it to the top. Pinning and snoozing preserve its active
position until you move it again. Thread activity does not change the order. The settled shelf
continues to use settlement time.

If dragging is unavailable for one environment, update the aprende server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

To generate a fresh title from the conversation, open a thread's menu and choose
**Regenerate title**. The action is unavailable while title generation is in progress
or when the connected environment needs a server update.

Agents connected through aprende can use the same server-owned metadata workflow to
rename a thread or regenerate its title. These changes
appear on web, desktop, and mobile without requiring the originating browser to remain
open.

### Fold working threads (beta)

Threads that are working or waiting on work they will resume from move into a collapsed
**Working** section below the active list.
That includes subagents and background commands or monitors the agent
says it is waiting on. A dev server or other process an agent leaves running does not keep a thread
there. A thread returns to the top of the active list when it finishes, fails, or needs an approval or
answer. The Working section lists the thread you last sent work to first. Pinned threads stay in
the pinned section.

The active list is ordered by when each thread last came back to you, so you cannot drag or move
threads within it.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent. Settling also closes the thread's
terminals that wait at an idle prompt, and keeps their output. A terminal that
runs a command, such as a dev server, stays open.

On web and desktop, press a thread's **Settle** button and drag up or down to
settle every thread in that section between it and the one you release on.
The **Un-settle** and **Wake** buttons work the same way in their sections.
Press `Escape` while dragging to cancel.

Environments settle inactive threads after three days. An empty thread's
inactivity counts from when it was created. Work in progress, pending questions or approvals,
and background work the agent is waiting on prevent automatic settlement.

To keep one thread out of the settled shelf no matter how long it sits idle, open its menu,
choose **Auto-settle behavior**, and pick **Disabled**. The current option is checked. Pick
**Enabled** to return to the usual rules. Manual settle, snooze, and archive still work while it
is disabled.

These rules run on the environment, so they continue when your apps are closed.
Mixed values show where the selected environments disagree. Mobile applies these
rules to connected environments that support shared settings. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
already settled threads.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments by title, branch, or project.
Threads you open often or recently rank higher, and for three weeks the thread
you last picked for a query ranks higher when you type that query again.
Threads whose messages contain all your words appear below, under **In
messages**, and open at the matching message. Message search needs at least
one word of three or more letters, or two for Chinese, Japanese, and Korean.
On mobile, the thread list search also lists message matches and opens them at
the matching message; on an iPad with a keyboard, `Cmd+K` opens the same
palette.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread link, which opens the thread from anywhere you paste it and pastes into a
composer as a thread chip (see [sharing a thread](./prompt-links.md#share-a-thread)).
**Thread ID** copies the bare ID for scripts and the `aprende` CLI. See
[keybindings](./keybindings.md) for custom configuration.

## Inspect agent work

**Limited** means the provider stopped on a usage or rate limit. The conversation
keeps the provider's explanation. Retry after the limit resets, or switch to
another provider instance.
Press **Resume** in an empty composer to continue a limited or interrupted turn
manually. Do this when the provider reports no reset time, because nothing
continues the turn on its own.
Queued messages stay saved while the limit blocks the thread. They run after
the continuation finishes. If the queue was held by a restart, resume it then.

When the provider reports a reset time, choose **Resume at reset** to schedule a
continuation. You can cancel it from the thread.
The environment must be running when the reset arrives; it resumes overdue
continuations after a restart. Stopping the thread, sending a new message,
archiving, or settling it prevents a pending continuation from starting.

Choose **Snooze until reset** to hide the thread until its allowance returns.
Snooze and auto-resume are independent: snooze alone wakes the thread without
sending a message; enabling both wakes and continues it. **Wake now** cancels
the snooze. Providers without a reset time offer manual
retry and the normal snooze choices.

On web and desktop, use **Agents** to follow work delegated to subagents.
On mobile, open a subagent from its conversation card or **Agents**. On iOS
layouts with an inspector, its thread opens beside the parent. Maximize it to
fill the screen; close the full-screen view to return to the parent and inspector.
Stop on a thread also stops the subagents it delegated to.

Subagent threads started by the agent can't take messages; message the parent
thread instead. When such a subagent needs an approval or an answer, the parent
thread asks for it.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

On web and desktop, the lesson details card lists the local servers that the
thread's terminals or its Claude agent started, with their ports. Not every one
serves a web page. A server the agent started stays listed after the agent's
turn ends.
Select a server to open it in the browser panel. **Stop** ends the server's job
and keeps the agent, the terminal, and aprende running. Stop needs terminal
access to the environment and is not available on Windows.

The lesson details card is closed until you open it with the button at the top right of a lesson.
To choose what it shows, right-click the card. Hidden rows keep their keyboard shortcuts, such as
Open notebook folder and project scripts. **Reset to default** brings back the standard rows.

## Side chats

A side chat lets you ask a question about a thread without adding to it. It starts
with what the thread knows, and the thread keeps working while you ask.

On web and desktop, start a message with `/side` or `/btw`, then your question.
You can also choose **Side chat** from the **+** menu in the right panel. The side
chat opens as a tab there, with its own composer. Side chats do not show in the
sidebar. Find one again under **Side chats** in lesson details.

A side chat works in the same folder as the thread. Its first reply asks before it
edits files or runs commands. After that, it uses the permission mode you choose
in its composer.

To use what you learned, choose **Bring back**. The thread gets the side chat with
your next message there. Bring back is available while the thread is idle.

Closing a side chat you never sent a message in deletes it. To delete one you used,
choose **Delete** at the top of the side chat. Deleting a thread also deletes its
side chats.

On mobile, a thread lists its side chats above the composer. Tap one to open it and
answer its questions.

## Snooze until later

The snooze menu offers 1 hour, 3 hours, 6 PM today, 9 AM tomorrow, and 9 AM next
Monday. Menus list the options soonest first and hide a today option after its time passes.

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. On web and desktop, you can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early.
A snoozed thread keeps working and stays hidden until its wake time, even while
its agent wakes itself for background work. It comes back early only when it needs
an approval or answer from you, when a run fails, or when you send it a message.
