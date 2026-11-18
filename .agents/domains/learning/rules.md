# Learning rules

Product decisions the developer settled, one per line, oldest first: `YYYY-MM-DD: <rule>. Receipt: <PR or issue URL>`. When a rule changes, rewrite its line and its receipt.

2026-11-12: Starting-point phrases name the idea in ten words or fewer, never a report on the learner, and the server refuses a phrase over `LEARNING_STRAND_PHRASE_MAX_CHARS` (140). Receipt: https://github.com/BernyMP/aprende/pull/30
2026-11-12: A question or problem card is always the last thing in the tutor's turn; the app orders it (`answerCardsLastInTurn`), because prompt wording and a PostToolUse hook both failed, and the tutor never points at the card, restates it or says how to answer. Receipt: https://github.com/BernyMP/aprende/pull/31
2026-11-12: A new notebook's first session ends at its outline: when `get_outline` shows `needsOutline`, the tutor measures, proposes the outline and does not plan or teach in that session. Receipt: https://github.com/BernyMP/aprende/pull/32
2026-11-12: A practice problem with several separate answers names each in `pose_problem` `parts` and gets one field per part; one piece of work stays one box, and a code workspace takes no parts. Receipt: https://github.com/BernyMP/aprende/pull/33
2026-11-12: Question and practice cards ask for no confidence rating and no thinking-out-loud box. Receipt: https://github.com/BernyMP/aprende/pull/33
2026-11-12: Before a guess the tutor gives what it needs (what the idea is for, the picture, the terms, what it builds on) and leaves out the answer; measuring questions and review get no frame. Receipt: https://github.com/BernyMP/aprende/pull/34
