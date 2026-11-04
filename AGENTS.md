# Foundation enforcement

Keep intent in docs and names. Executable source/config has no comments. `arch/` and `design/` are non-runtime design references, excluded from comment enforcement and never imported into production.

| Risk | Required fix | Enforcement and negative proof |
| --- | --- | --- |
| Agent receipt keys occupy browser namespace or repeat Stop changes its timestamp | Reject reserved agent keys before store access and preserve the first Stop | checkControlPrerequisites; missing/dead guard and timestamp-overwrite fixtures; PostgreSQL receipt absence and repeated Stop |
| Comments outside src | Use parser-checked comment-free JS/TS, YAML, JSON and SQL | check-no-comments; test/lint.test.mjs |
| SDK in domain | Keep SDK imports in boundary adapters | checkSdkImports; SDK-import fixture |
| Permissive wire objects | Use strict schemas including union branches | checkWire; permissive-object fixture |
| Prompt arguments silently discarded by SDK | Strictly parse raw GetPrompt arguments | checkRegistryAdapter; actual registerPrompt fixture; protocol extra-key rejection |
| Nonpublic source URLs published as confirmed facts | Use public HTTPS DNS source validation | checkReleaseSources; reproduced loopback/private fact fixtures; publication regression |
| Union schemas disappear in SDK listing | Derive list/call handlers from registry | checkRegistryAdapter; high-level registration fixture; protocol schema comparison |
| Schema dialect mismatch | Emit draft-7 for pinned SDK | checkWire; 2020-12 fixture |
| App visibility mistaken for identity | Remove legacy person mint; verify nominal browser authority; give MCP only a bound link function | checkPersonBoundary/checkBrowserControls/checkControlImports/checkHuntAuthority; structural/reflected authority, full-codec type/dynamic import and public codec export negative fixtures; native HTTPS controls |
| Incompatible SDK helpers | Retain tested 1.32.2 / 1.7.5 pins until spike reruns | checkDependencyPair; previous 2.0.4 fixture |
| Wildcard ports rejected by transport | Use exact local socket port in allowedHosts | checkHostConfig; wildcard-host fixture |
| Foreign browser Origins accepted by transport | Allow exact loopback HTTP origins at the local socket port and the configured HTTPS issuer | checkHostConfig; missing/empty/foreign-Origin fixtures; raw HTTP Origin test |
| Extra product tools | Keep four registry names | checkTools; extra-tool fixture |
| Paid or self-hosted CI runner | Use standard ubuntu-latest | checkWorkflow; self-hosted fixture |
| Shallow hosted checkout lacks trunk evidence | Fetch full history before P05 verification and performance probes | checkWorkflow; original shallow checkout regression |
| Missing Node ambient types under TS7 | Include node in compiler types | checkTypeConfig; missing-types fixture |
| Driver inherits incompatible Node flags | Fork with an empty execArgv array | checkDriver; inherited-flags fixture |
| Failed initialization leaves a client running | Close client before rethrowing connect failure | checkDriver; missing-cleanup fixture |
| Code-origin label bypasses source authority | Validate tested codes against the pinned official domain | checkCodeAuthority; original label-only guard; source rejection and official-source pricing regression |
| Structured view loses quote scenarios | Keep all quotes in HuntView and render text from that projection | checkScenarioProjection; original HuntView shape; losing, unknown and limited quote regression |
| Conditional rewards lose attribution | Retain scenario selection, later rewards and perks together | checkScenarioProjection; original conditional shape; exact-set reward regression |
| Invalid sellers or extra slots count as complete | Check exact recipe slots and exclude the original shop using canonical seller identity | checkViewCoverage; original signatures and slot loop; original-shop, duplicate and extra-slot regression |
| Fresh hosted runner lacks ~/tmp | Allocate task scratch with scratchDirectory, which creates its parent | checkScratchAllocation; original mkdtemp calls; absent-parent concurrent allocation regression |
| Finish disagrees with inferred seller coverage | Use canonical HuntView.progress for the finish decision | checkDurableCommands; original nullable seller call; PostgreSQL unspecified-shop regression |
| Race harness releases before database contention | Prove a PostgreSQL lock conflict before signaling a contended barrier | checkRaceBarriers; both original premature signals; real NOWAIT conflicts retained in verification receipts |
| Lock guidance prescribes superseded behavior | Document exclusive hunt fences for finish and stop | checkTransactionGuidance; original every-row sentence |
| Request headers extend trusted host lists | Keep lists immutable with only the configured issuer extension | checkHostConfig; request-Origin, request-Host and alias mutation fixtures |
| Authentication result discarded or production falls back to fixture dispatch | Construct the dispatcher from the awaited principal after fail-closed configuration and authentication checks | checkRemoteBoundary; ignored-principal and unused-denial fixtures |
| Public reexports expose authority constructors | Use named value exports and keep auth authority internal | checkPublicAuthority; export-star and aliased authority fixtures |
| Capability database aliases bypass account fences | Confine pool acquisition to the private fenced query method and renew atomically | checkGrantRenewal; aliased-pool and commented-SQL fixtures |
| Consent check runs without rejecting | Return on invalid explicit allow/deny before completing consent | checkConsentDecision; unused-check fixture; actual HTTPS consent probes |
| Authorization path aliases bypass request policy | Validate parsed parameters through provider hooks and require an explicit resource | checkAuthorizationPolicy; original raw-path fixture; HTTPS alias regressions |
| Discovery advertises flows and endpoints beyond the shipped surface | Configure code-only response types, OpenID scopes and disabled unused issuer endpoints | checkAuthorizationPolicy; refresh-scope, enabled-userinfo and enabled/missing-DPoP fixtures; actual discovery assertions |
| Linking strands in-flight requests on an empty old account | Refuse candidates with hunts or other identities, then retire an empty old account under its exclusive fence before identity movement | checkLinkRetirement; candidate hunts/other-identity refusal fixtures; original missing-retirement fixture; authenticated old-principal PostgreSQL rejection |
| Database outage invalidates valid credentials | Return 503 for infrastructure errors and 401 only for typed credential failures | checkRemoteBoundary; removed error-class branch fixture; actual PostgreSQL outage probe |
| Linking requires a synthetic cookie or reuses confirmation | Begin with a browser GET, reauthenticate both identities and consume a browser-bound confirmation once | checkBrowserLink; removed browser entry and replayable-query fixtures; HTTPS forged/replayed confirmation probes |
| OAuth edits miss verification routing | Route auth changes from the skill description, branch selector and feature index | checkAuthVerification; original excluded-OAuth header and absent-route fixtures |
| Erasure skips a private owner or uses a shared account fence | Accounts awaits fixed feature deletion ports under the exclusive active account fence | checkErasureCoordinator; missing-await and shared-fence mutations; populated owner inventory and real 55P03 races |
| Unknown subject silently recreates an erased account | Resolution is read-only; explicit fresh browser enrollment owns provisioning | checkExplicitEnrollment; original INSERT fixture; old bearer/subject rejection and fresh enrollment regression |
| OAuth Interaction ownership hides in nested objects or parents | Normalize every nested/multiple accountId and inherited Grant/Session owner before writes | actual top-level-only DELETE leaves nested fixture; normalized deletion removes it; parent-derived and late-owner regressions |
| Cursor leaks caller metadata or cannot read the next page | Encode only account/incarnation/collection and scoped position | original extra-kind cursor failed the 100-item probe; compiled recent page-two and 100-saved-item pagination regression |
| Migration drifts from startup schema or revokes on every boot | Keep SQL equal to exported installation schema and use a one-time version marker | real PostgreSQL migration equality, legacy revocation and second-application preservation; malformed ALTER negative probe |
| Memory edits miss verification routing | Route P06 from the skill header, selector and feature index | checkMemoryVerification; missing-P06 route fixture |
| Enrollment crosses an erase commit after an earlier suppression read | Lock sorted subject identities before the account fence and recheck inventory | checkErasureCoordinator; dead-body, missing-lock, missing-tombstone, wrong-account and missing-recheck fixtures; lifecycle enrollmentSubjectConflict and concurrentIdentityInventory regressions |
| Fractional PostgreSQL milliseconds break strict confirmation deadlines | Round database milliseconds before signing | checkBrowserControls; original fractional deadline negative fixture; codec fractional-time regression |
| Browser control edits miss verification routing | Route P07 browser controls through the skill header, selector, feature index and executable branch | checkControlVerification; missing header, route, index and driver fixtures |
| Memory transcripts overwrite runner memory metadata | Name measured RAM memoryBytes separately from the Memory result | memory-evidence.test.mjs reproduces the original overwritten field and preserves both values |
| Application clock skew bypasses erasure suppression | Stamp browser flow starts with the database clock and preserve the start through every confirmation write | checkBrowserFlowClock; initial/confirmation Date.now, missing-flow-spread and discarded-start fixtures; lifecycle databaseFlowClock with one-hour application skew |
| Long erase transactions admit callbacks started before suppression | Stamp suppression cutoff and retention at the fenced write with the database wall clock | checkErasureCoordinator; transaction-now fixture; real HTTPS transactionStartDoesNotWeakenSuppression regression |
| Erase result recovery is unreachable after losing credentials | Link a credential-free GET form with same-origin Referrer-Policy before erasure and POST the saved status secret; serve the secret confirmation with no-store | checkEraseRecovery; missing confirmation no-store, absent/dead GET, wrong form, missing-link and no-referrer fixtures; Chromium native-form recovery and foreign-Origin rejection |
| Linking admits a callback started before erasure | Preserve the first link flow start and check suppression under the subject lock | checkLinkSuppression; removed/dead refusal, reset-start and wrong-lock fixtures; stale HTTPS callback and confirmation-spanning-erasure rejection; fresh post-erasure link regression |
| Vulnerable card build dependency returns | Pin the verified Vite 6.4.5 patch until a replacement is verified | checkCardBuild; prior 6.4.1–6.4.4 fixtures; clean npm audit |
| Card bundling deletes emitted server controller modules | Preserve emitted modules while the build cleans once | checkCardBuild; emptyOutDir true negative fixture and compiled controller import |
| SDK transport logs private card grant messages | Use a source-checked quiet transport with schema validation | checkCardBuild; default PostMessageTransport, console and removed/dead message-source guard fixtures; transport foreign-source regression; Chromium rotating-grant DOM/console absence |
| Card edits miss verification routing or leave obsolete docs | Route P07 through header, selector, index and driver; document current card/controls in one enforcement table | checkCardRouting; missing routes, stale fixture/card claims and split-table fixtures |

P01 is local fixture transport only. New real authentication must replace the denied boundary and update its enforcement in the same phase. Keep isolated fixture imports out of the server bundle. Later phases extend the verification feature map after their public behavior works.
