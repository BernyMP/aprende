The learning domain agent owns this file: the tutor prompt, the `learn` MCP tools, learning cards and the tutor-teaching evals. Its settled decisions are in `.agents/domains/learning/rules.md`.
Top rules: a question or problem card is always last in the tutor's turn, and the app puts it there; before a guess the tutor gives what the guess needs, never the answer; separate answers get `parts`, one field each. Tutor-facing text: run the evals `evals/README.md` names.
Before you change behavior here, ask the `learning-domain` subagent (read-only) to check your plan or diff against those rules.
