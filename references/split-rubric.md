# Split Rubric

Use this rubric to keep `AGENTS.md` concise while preserving full guidance in `docs/*.md` topic files, and to keep `CLAUDE.md` / `GEMINI.md` as minimal redirect stubs back to `AGENTS.md`.

## Essential Section Template

Every `AGENTS.md` topic section should follow this two-bullet shape:

```md
## HTML Classes
- Essential directive: every rendered intrinsic HTML/SVG element must include a compliant class token.
- Full specification, naming rules, maintenance, and enforcement commands: `docs/HTML_CLASSES.md`.
```

```md
## I18n
- Source of truth: `docs/LOCALES.md`.
- When changing i18n-enabled text, follow `docs/LOCALES.md` exactly (verification, auto-fix, validation).
```

## What Goes Where

| Content type | Destination |
|-------------|-------------|
| Long command blocks | `docs/*.md` |
| Naming grammars and token constraints | `docs/*.md` |
| Examples and counterexamples | `docs/*.md` |
| Migration instructions | `docs/*.md` |
| Troubleshooting and caveats | `docs/*.md` |
| Audit/check scripts and their options | `docs/*.md` |
| Scope and precedence rules | `AGENTS.md` |
| Short non-negotiable directive | `AGENTS.md` |
| Exact path to detailed topic doc | `AGENTS.md` |
| Redirect to `AGENTS.md` | `CLAUDE.md` / `GEMINI.md` |
| Instruction to read closest local `AGENTS.md` | `CLAUDE.md` / `GEMINI.md` |

## Consistency Rules

1. Keep `AGENTS.md` as the only canonical policy file.
2. Keep `CLAUDE.md` and `GEMINI.md` identical in meaning as redirect stubs.
3. Avoid contradictory wording between `AGENTS.md` and any redirect stub.

## Repo Coverage

Apply the same split policy to the root repo and each submodule listed in `.gitmodules`. Do not assume one repo's docs substitute another repo's local guidance.
