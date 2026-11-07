# Learning sessions

A session starts with what you want to understand. Type your goal in the composer, such as
"I want to understand how transformers use attention" or "help me get eigenvectors".

## How a session goes

1. **Your goal.** The tutor asks a few questions until the goal is concrete enough to test. In your
   first session it also asks what you are after and how often you plan to study (see
   [About you](#about-you)).
2. **Where you are.** Before teaching, the tutor asks questions that find where your understanding
   ends on each thing the goal depends on. It then shows a summary of what is solid and where to
   start.
3. **Your path.** The tutor draws a map from what you already know to the goal. An arrow means one
   idea has to come before the next. The map changes when teaching shows it was wrong, and it
   highlights the step you are on.
4. **One step at a time.** For each step you first guess what comes next, then get the explanation,
   then check yourself with a question that applies it. Check questions stay folded until you choose
   **Check your understanding**, so you can finish reading first. Where you are new to the subject,
   steps start with a fully worked example and hand more of each next example to you. Where you
   already know the ground, steps start with a problem for you to try.

## Answering

- Pick an option, or write your answer for questions that ask you to recall it in your own words.
- Optionally pick how sure you are: **Guessing**, **Fairly sure** or **Certain**. A confident wrong
  answer tells the tutor about a misconception; a lucky guess tells it the idea is still fragile.
  Choose **Hide** to stop being asked, and turn it back on in **Settings > Tutor**.
- Write your thinking out loud in the thinking field. It can be rough or dictated. The tutor reads
  it to find where a confusion starts.
- **I don't know** is a useful answer, not a failure.

After you answer, the card shows the correct answer and why.

## Practice

Practice problems make you use what you learned, not just recognise it. The tutor offers them after
teaching a step and near the end of a session. To start whenever you like, ask for it, for example
"Let me practice this" or "Give me problems on eigenvectors".

- Work the problem in the card. Your work, how sure you are (if you say) and your thinking all go to the tutor.
- **Hint** shows one hint at a time, gentlest first. The tutor sees how many you used.
- **Give up** sends what you have so far. It tells the tutor where to help.
- After the tutor judges your work, the card shows its verdict and a complete solution. Choose
  **Next problem** for another.

Problems you missed, or got right while unsure, come back as a **Retest** in a new form before the
practice ends.

When your goal involves programming, problems come with code. The tutor's starter files go in a new
folder under `practice/` in the subject's folder, and **Open** shows them in the files panel, where
you edit them. **Run check** runs the tutor's test command in that folder and shows its output,
stopping it after 30 seconds. It runs on your computer with your permissions, as your own terminal
would, so read the command before you run it. **Submit** runs the check once more and sends your code
to the tutor. The folder stays after the problem ends.

**Terminal** opens a shell in the practice folder for programs that read what you type, running on
your computer with your permissions like **Run check**. Hiding the panel keeps it running with its
recent output; closing its tab ends the shell.

## Files

Mention files with `@` or by path, such as a PDF of lecture notes or a photo of a worked problem.
The tutor reads them but never changes them.

## What aprende remembers

The tutor records the key ideas each session taught, and how they follow from each other, in a
knowledge graph on your computer. New sessions check it first, so the tutor skips what you already
learned.

## Knowledge

**Knowledge** lists everything your sessions have recorded, newest first. Open it from the sidebar
or the command palette, or press `mod+alt+k` (customize `knowledge.open` in
**Settings → Keybindings**). Each idea shows what it follows from and the sessions that taught it;
open a session to reread how it was taught. Search, or pick a subject, to narrow the list.

To practice, select the ideas you want and choose **Practice**. aprende starts a session in the
subject that taught them most recently, or another subject you pick, and the tutor starts posing
problems on exactly those ideas.

## Review

Ideas you learned come back for review, spaced further apart each time you recall them. Bringing
an idea back from memory just as it starts to fade is what makes it last.

Each idea shows when its next review is. **Due for review** lists the ones due now; open it from
**Knowledge**, from the command palette (**Review what's due**), or press `mod+alt+r` (customize
`knowledge.review` in **Settings → Keybindings**). **Review** starts a session on the most overdue
ideas, up to 10, where the tutor asks you to recall them.

How a review goes sets the next one. Solving a problem without hints sends the idea twice as far
out; needing hints or being unsure keeps the same gap; a miss starts it over at the shortest gap. Practicing an idea before it is due does not count toward its schedule. The first gap
follows how often you study (see [About you](#about-you)).

**Snooze a week** puts off a due idea; **Unsnooze** brings it back.

## About you

**Settings → Tutor → About you** holds a few choices the tutor follows:

- **What you're after:** deep understanding, preparing for an exam, a skill to use, or the gist.
- **How often you study:** sets how soon ideas come back for review.
- **Teach in** and **Examples from:** the language to teach in, and things you care about for
  examples.
- **Diagrams** and **Explanations:** how often you want a diagram, and how long explanations run.

While either of the first two is not set, the tutor asks for it on a card and saves your answer. It may suggest
a change later; nothing changes unless you choose it. These change how the tutor teaches, never
whether you do the work: it still asks you to predict and check, and it gives hints, not answers,
on problems you are working.

## The tutor prompt

**Settings → Tutor → Tutor prompt** shows the instructions the tutor follows. You can edit them and
restore the default at any time. Your choices under **About you** are added after whichever prompt
is in use, so you keep them, and later improvements to the default, without editing it. Changes
apply to sessions you start or resume after saving.
