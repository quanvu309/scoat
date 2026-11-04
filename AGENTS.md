# Foundation enforcement

Keep intent in docs and names. Executable source/config has no comments. `arch/` and `design/` are non-runtime design references, excluded from comment enforcement and never imported into production.

| Risk | Required fix | Enforcement and negative proof |
| --- | --- | --- |
| Comments outside src | Use parser-checked comment-free JS/TS, YAML, JSON and SQL | check-no-comments; test/lint.test.mjs |
| SDK in domain | Keep SDK imports in boundary adapters | checkSdkImports; SDK-import fixture |
| Permissive wire objects | Use strict schemas including union branches | checkWire; permissive-object fixture |
| Prompt arguments silently discarded by SDK | Strictly parse raw GetPrompt arguments | checkRegistryAdapter; actual registerPrompt fixture; protocol extra-key rejection |
| Nonpublic source URLs published as confirmed facts | Use public HTTPS DNS source validation | checkReleaseSources; reproduced loopback/private fact fixtures; publication regression |
| Union schemas disappear in SDK listing | Derive list/call handlers from registry | checkRegistryAdapter; high-level registration fixture; protocol schema comparison |
| Schema dialect mismatch | Emit draft-7 for pinned SDK | checkWire; 2020-12 fixture |
| App visibility mistaken for identity | person always throws in P01 | checkPersonBoundary; forged-person fixture; direct-call protocol test |
| Incompatible SDK helpers | Retain tested 1.32.2 / 1.7.5 pins until spike reruns | checkDependencyPair; previous 2.0.4 fixture |
| Wildcard ports rejected by transport | Use exact local socket port in allowedHosts | checkHostConfig; wildcard-host fixture |
| Foreign browser Origins accepted by transport | Allow only exact loopback HTTP origins at the local socket port | checkHostConfig; missing/empty/foreign-Origin fixtures; raw HTTP Origin test |
| Extra product tools | Keep four registry names | checkTools; extra-tool fixture |
| Paid or self-hosted CI runner | Use standard ubuntu-latest | checkWorkflow; self-hosted fixture |
| Missing Node ambient types under TS7 | Include node in compiler types | checkTypeConfig; missing-types fixture |
| Driver inherits incompatible Node flags | Fork with an empty execArgv array | checkDriver; inherited-flags fixture |
| Failed initialization leaves a client running | Close client before rethrowing connect failure | checkDriver; missing-cleanup fixture |

P01 is local fixture transport only. New real authentication must replace the denied boundary and update its enforcement in the same phase. Keep isolated fixture imports out of the server bundle. Later phases extend the verification feature map after their public behavior works.

| Fresh hosted runner lacks ~/tmp | Allocate task scratch with scratchDirectory, which creates its parent | checkScratchAllocation; original mkdtemp calls; absent-parent concurrent allocation regression |
