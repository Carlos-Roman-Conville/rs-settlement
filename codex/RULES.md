# Rules for Codex (and any belt worker) in `Toolchain/settlement`

1. Read `README.md`, then the `CONTRACTS.md` section and the `PACKAGES.md` section your task names. They are the
   spec. `QUESTIONS.md` lists what Rex has not decided: never answer one of those in code; a config key or an
   explicit "not decided" throw is the only allowed placeholder.
2. The engine imports no game and no other engine (`@rex/kernel` is allowed once adopted). Cross-engine needs are
   provider interfaces in `src/providers.ts` or `src/contracts/`; the text of a contract file is byte-identical to
   the block in `CONTRACTS.md` and to the economy's copy. Never edit `CONTRACTS.md` in a unit.
3. `port.*`, `sec.*`, person ids, `pool.*`, fixture, role and recipe ids are the host's: never minted, parsed or
   interpreted here. Engine ids come from `mint` only.
4. `reduce` clones the state first; a command either applies whole or throws. Every number a host could choose
   (bands, hours per day, sharing rules) is a config key in `src/config.ts`, marked proposed.
5. Deterministic everywhere: no `Math.random`, no `Date.now`, no iteration over unordered keys where order reaches
   the output; a replayed log mints the same ids.
6. Style matches the package: TypeScript strict with `erasableSyntaxOnly` (no parameter properties, no enums),
   `verbatimModuleSyntax` (`import type`), ES modules with `.ts` import suffixes, small files, one describe per
   TESTS.md row, test titles naming the rule.
7. Run only your own tests while working (`npx vitest run test/<file>.test.ts -t '<name>'`); the runner runs the
   Gate (the whole suite, the typecheck, and where the task says so the pirate web suite and the kernel goldens).
8. Change only the files the task names. Never touch `Games/RPG's/pirate-ship` from a settlement unit unless the
   task names a path there. Never push.
9. One commit, not pushed, ending with `Co-Authored-By: OpenAI Codex <codex@openai.com>`. Nothing left uncommitted.
10. Close with a short report: done or parked, tests run, commit hash. A disagreement with the spec is parked in
    the report, not resolved in code.
