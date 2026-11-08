# Intelligent Inbox delivery

## Aim

Muness opens Inbox to find meaningful email, act on recommendations, reduce recurring noise, and teach standing preferences through ordinary language. Purchase receipts remain available for expense work after archiving. Consulting and AlixPartners expense destinations remain distinct.

The mechanism is a default contextual inbox with evidence-backed actions, persisted preferences, background processing and a shared command interface. Its hypothesis is that grouping repetitive decisions and applying explicit standing instructions reduces attention spent per incoming message.

Success means real mailbox examples support unsubscribe recommendations, automatic receipt archiving, expense suggestions and stars, and multi-instruction text with editable application. Mail actions reach the owning provider. A suggestion explains its evidence. New mail receives saved automation and historical mail remains searchable.

Constraints are NAS-backed PostgreSQL and storage, existing Tailnet identity, 9950X for builds/inference, existing OAuth for all five mailboxes, agent-accessible state, preserved keyboard navigation and provider propagation. Deployment must survive the workstation going away. Email content supplies evidence and cannot authorize actions. No fabricated email data. Expense submission and knowledge-base destination selection remain future integrations.

## Problem Space

The default email experience combines meaningful communication, recommendations, automation and natural-language instruction. It is called Inbox. Reading, replying, searching, undo and all-mail access remain necessary. Inbox status and expense status are independent. One-off action and standing preference require distinct persistence and explanations. Existing PostgreSQL synchronization and outbox provide mailbox state and provider mutation. Unsubscribe metadata, durable inference, preferences, recommendations, expense state and downstream events require implementation.

## Problem Weave

Independent framing passes are running for experience, intelligence, and operations/evidence. The coordinator owns synthesis and epic selection. The user has authorized implementation through working deployed software.

### Independent synthesis and selected epics

Three independent agents returned experience (U), intelligence (I), and operations/evidence (O) frames. Shared core is meaningful attention, durable explicitly taught intent, and source-account effects with durable evidence. Experience owns attention and interaction; intelligence owns interpretation; operations owns execution and provenance. These are complementary responsibilities.

| Step | Parent | Depth | Strategy | Tactic | Necessity / parallel assumption | Disposition | Owner / review trigger |
|---|---|---|---|---|---|---|---|
| E1 | root | 1 | Find meaningful mail and act quickly | Default Inbox groups, evidence, existing thread/compose access, keyboard/mobile | Attention must be usable; existing unified view can host it | selected | experience / important mail hidden |
| E2 | root | 1 | Express and retain intent | Integrated paragraph planning, editable scoped proposals, apply, rule management | Buttons cannot express arbitrary preferences; typed plans support validation | selected | intelligence + experience / intent or scope mistranslated |
| E3 | root | 1 | Handle routine mail consistently | Persistent semantic results, rule evaluation, ordered provider jobs and unsubscribe metadata | Page-local recommendations cannot process new mail; existing sync/outbox enables durable work | selected | operations + intelligence / duplicate or wrong-account effects |
| E4 | root | 1 | Recover purchases for correct expense workflow | Independent expense records, evidence, destinations, stars and archive coexistence | Labels alone lose routing; Postgres supports durable separate state | selected | all / archive erases evidence or destination conflation |
| E5 | root | 1 | Observe and correct delegated work | Activity/events, errors, rule edits, source verification and deployment | Automation needs visible outcomes; existing provider confirmations can be linked | selected | coordinator + all / success claimed before source confirmation |
| E3.1 | E3 | 2 | Understand new mail without blocking Inbox | Incremental background semantic classification | Live inference on every page load repeats former latency problem | selected | operations / stalled classification or inference errors |
| E3.2 | E3 | 2 | Reduce subscriptions at their origin | Retain subscription identity and distinguish one-click execution from preferences URL | Sender domain is too broad; source headers provide actual mechanism | selected | operations / false unsubscribe success |

Sufficiency group ROOT-all comprises E1–E5, all required for attention, intent, execution, downstream outcome and feedback. Group AUTOMATION-all comprises E3.1 and E3.2, all required for semantic processing and subscription handling; ordered actions and explicit rules are shared with E2/E5. Root depth is zero. Evidence provenance is user-confirmed intent plus inspected existing UI, model client, PostgreSQL store and outbox; live inference availability remains a check.

U1 complements I1/E1/E3.1. U2 and O2 jointly require E3.2. U3/I2/O1 share durable instruction but retain separate interpretation/execution responsibilities. I3/O3 overlap on independent expense persistence and are merged into E4. E2 depends on grounded source/account resolution. E1 depends on persisted results but must display incoming unclassified mail. E4 depends on original evidence, never inbox membership.

### Opposition and resolution

Automation throughput versus ambiguity is resolved by executable explicit preferences and surfaced unresolved clauses. Attention prioritization versus hidden important messages is resolved by accessible all-mail and visible unclassified arrivals. Explanations versus density uses short reasons with expandable evidence. Full historical analysis versus immediate usefulness prioritizes recent mail and continues incrementally. These trade-offs remain review triggers, not assumptions of perfect inference.

### Solution selection

Evaluated adding badges to the chronological list, a separate review queue, and a default contextual Inbox with shared text/action/rule state. The default Inbox is selected because the user explicitly requires it as their normal email interaction. Existing thread rendering and provider outbox are retained as reusable mechanisms. E1–E5 are selected epics, authorized for implementation through deployment. External expense submission and a particular downstream knowledge system remain deferred. Human examples will be evaluated against actual messages, not invented fixtures.

### Wiring follow-up

All durable artifacts remain local candidates for later record-system normalization. Outcome = meaningful email with less recurring attention (root); capabilities = contextual Inbox (E1), instruction and rules (E2), source automation (E3), expense evidence (E4), auditable events (E5). Signals are correct source effects, preserved receipt retrieval, correct business routing and responsive Inbox. Guardrails are account ownership, explicit instruction authority and NAS/9950X deployment. This local epic record fulfills the requested capture; external issue or record creation is deferred.

## Delivery evidence

Implementation in progress. Completion requires real-data API/UI checks, build on 9950X, NAS migration/deployment, restart persistence, agent access, and explicit limitations for any incomplete branch.

## Solution Space

### Email-triggered investigation and remediation

User scenario is recurring HiPhi Cloud monitoring unavailable/recovered mail and the instruction to clean up monitoring, open an issue, investigate and fix the cause. Read-only live Inbox search found repeated outage/recovery pairs. Original message previews explicitly say monitoring availability does not establish installation connectivity and local playback is unaffected. Existing generated summaries sometimes claim connectivity impact, an unsupported inference requiring source-first verification in handoffs.

Objective is to turn the user's instruction and source mail into tracked work that resolves the cause and reports back. Success requires a canonical issue, evidence-based diagnosis, a verified change, and meaningful Inbox status. Creating an issue alone is insufficient.

| Candidate | Frame | Main cost / limitation | Disposition |
|---|---|---|---|
| Archive or group alerts | Inbox noise handling | Leaves underlying monitoring problem unresolved | rejected as sole solution |
| Create a task from email | Task capture | User still dispatches and follows up | deferred standalone; useful component |
| Durable delegated work linked to email and issue | End-to-end outcome | Requires project resolution, executor, state and verification | selected for next execution |
| Agent tooling embedded fully inside mail client | Email application owns engineering workflow | Duplicates repositories, logs and engineering tools | rejected |

Selection adds candidate E6 under root, with E6.1 context/project resolution, E6.2 issue reconciliation and agent execution, E6.3 verification and Inbox feedback. These tactics are selected for next implementation; owner coordinator/agent runner. Sufficiency group DELEGATION-all requires all three. E6 complements E1/E2/E5 and depends on durable events and actual executor/inference availability. Expense and subscription branches remain separate.

A grouped alert should offer Investigate and fix. The paragraph interface can dispatch the same work. User intent is retained verbatim; source messages, account, project, timestamps and related issue are attached. The runner verifies which component failed, discovers logs/repo, investigates evidence, creates or updates one issue, implements and tests an authorized repair, and returns progress and links. Repeated mail links to active work and new materially different incidents remain surfaced.

Risk retirement checks before release: outage/recovery pair plus independent incident must not merge incorrectly; repeat dispatch/retry must reuse work and issue; recovered monitor alone must not mark remediation complete; source preview versus generated connectivity claim must resolve against original evidence; ambiguous project must prevent wrong-repository changes; a stopped executor must leave visible resumable work. The integration is not implemented by this design record. Runner identity, repo mapping, credentials and appropriate repair/deployment scope need evidence discovery. Source email is untrusted evidence, not instruction authority.

Working assumption: monitoring cleanup includes grouping duplicate alerts and fixing alert behavior while preserving genuine failures. No underlying cause is asserted. Durable canonical issue system and agent runner selection remain open until repository/infrastructure discovery. This route requires solving the existing model/provider and deployment-access blockers. Do not claim it works while those dependencies remain unavailable.

## Inference deployment — 2026-11-06

The NAS app and classifier now use the existing homelab Magpie gateway with
Claude Haiku 5.5. `MAIL_AI_BASE_URL` selects the OpenAI-compatible adapter for
both main and small models, with no OpenRouter fallback when configured. Secrets
remain in private runtime state. See home-infra `deploy/zero-poc/README.md` for
the host, runtime mapping and recovery details.

Live verification passed for model discovery, background classification, proposal
generation and Postgres persistence, and an empty-selection apply with zero
mutations. Intelligence JSON writes explicitly serialize parameters and cast to
jsonb after the live test exposed an object-to-wire serialization error.

## Solution Space — Dot delegation wiring (2026-11-06)

Problem: turn an explicit instruction attached to real mail into tracked investigation,
repair and verification, with retrievable context and two-way follow-up in Inbox.
Binding constraints: NAS PostgreSQL/storage, 9950X execution/builds, private service
access, no dependency on the desktop, no repeated interactive credential requests.
Success signal: a real HiPhi alert can be delegated, its full context fetched by the
executor, a question answered in Inbox, and evidence returned to that same task after
service restart. A delivered webhook is never evidence of completed work.

Decision criteria: context fidelity, restart/retry safety, private network access,
implementation burden, execution capability and ability to replace the coordinator.
Critical assumptions: this account can install the custom plugin, use a Dot event
subscription and associate a Secure MCP Tunnel; combined event subscription and
read/write tool access must work live. These account-specific facts are unverified.

Candidates considered:

| Option | Level / frame | Benefit | Cost / disposition |
|---|---|---|---|
| Open a chat with copied email | Band-aid; handoff is a prompt | Small implementation | Stale context, manual return, no durable automation; rejected |
| Dot owns workflow and state | Local optimum; agent conversation is task system | Uses existing coordination | Makes recovery depend on external memory and desktop access if connected locally; rejected as canonical state |
| NAS owns tasks; Dot coordinates over MCP; 9950X executes project jobs | Reframe; task is durable and agents are replaceable | Context callbacks, two-way updates, private execution | Adds event adapter and job interface; selected, gated on live transport proof |
| Self-hosted runner owns workflow through Magpie | Redesign; no Dot dependency | Existing inference and private access | Must implement coordination/resume/questions ourselves; deferred fallback if Dot integration fails |

Interpretive variety: the prompt-only option assumes handoff suffices; Dot-owned
workflow tests managed coordination; durable tasks separate ownership from execution;
the self-hosted option tests whether Dot adds enough value to justify integration.
Failure of the Dot proof changes executor selection, not the stored task contract.

Proposed wiring (internal contract, not yet implemented):
1. Inbox creates a task and outbox event atomically. Record exact user instruction,
   selected account/message/thread references, immutable source snapshot, context
   revision, project mapping, authorized scope, task state and related work links.
2. Extend the existing Streamable HTTP mail MCP service with get_task_context,
   paginated source/attachment retrieval, list_task_events(after_sequence),
   claim_task, report_task_progress, ask_task_question and complete_task tools.
   Existing thread retrieval is limited to 25 messages/12,000 body characters;
   it cannot stand in for full context. Return explicit truncation and paging.
3. Implement events/list, events/subscribe, events/unsubscribe and signed webhook
   delivery. Persist subscriptions, cursors, expiry, delivery attempts and stable
   event IDs in Postgres. Events carry task identity/revision and a small summary;
   the trusted standing Dot instruction tells it to fetch the actual task context.
4. Run tunnel-client as a service on the 9950X, reachable to the NAS MCP endpoint,
   using the existing private network. Associate its tunnel with the actual ChatGPT
   workspace and Platform org; install the custom plugin for the Dot. No public NAS
   listener or desktop relay. Tunnel runtime credential is service configuration,
   not an Inbox login. Availability/access must be proven before depending on it.
5. Configure Dot to follow explicit task-request and user-reply events. Dot reads
   context and claims work before side effects. User replies and new evidence append
   events/revisions to the same task. Dot writes progress, questions and result links
   through tools; Inbox renders them alongside the original mail.
6. Project work runs in a managed job on 9950X with checkout, task context reference,
   existing credentials, log/artifact persistence to NAS, and status/cancel/resume
   tools. Magpie supplies inference; it is not itself a durable job runner. The
   inspected Fleet provider agent provisions capacity, not general shell jobs.
   Discover reusable project runners before implementing another one.
7. Completion stores issue/PR/deployment links and verification evidence. Transport
   accepted, agent claimed, running, waiting, failed and verified are distinct.
   Expired leases require reconciliation of external effects before another attempt.

Risk retirement plan (planned dispositions, not claims of passed checks):

| Risk | Planned disposition | Tempting patch to reject | Evidence / pivot |
|---|---|---|---|
| Dot/tunnel/account incompatibility | Retired by evidence before product integration | Assuming two documented features compose | Dot receives event, reads real private context and writes receipt; if unavailable, choose self-host runner |
| Desktop dependency | Retired by evidence | Testing only while this app is connected | Repeat round trip with desktop bridge unused; any required desktop process triggers redesign |
| Truncated/stale context | Retired by evidence | Sending only generated summary or first 25 messages | Fetch original thread/attachment pages and newer revision, identify exact source; unavailable required context blocks dispatch |
| Duplicate/reordered events or uncertain side effects | Retired by evidence | Retrying creates another issue/job | Replay same event, reorder replies, restart after external action before ack; reconcile to one task/job/issue |
| False completion | Retired by evidence | Treating webhook 200 or monitor recovery as repair | Recovery-only alert remains unverified; completion references actual tests/change/deployment |
| Incorrect incident or project mapping | Retired by evidence | Grouping solely by sender/domain | Outage/recovery pair and independent incident stay correctly separated; ambiguous repo blocks project writes |
| Email mistaken for authority | Retired by evidence | Passing body as executable instruction | Original mail cannot extend user-authorized action scope; only persisted user instruction/standing policy can |
| Lost subscription or stopped executor | Retired by evidence | Silent stalled work | Restart tunnel/worker, expire subscription, resume cursor/lease; visible blocked/queued work and no lost events |
| Coordination cost exceeds benefit | Accepted with rationale for small proof only | N/A | Measure one round trip and real task; repeated latency/capability failures trigger self-hosted option |

Dissent decision: ADJUST. Dot is a plausible coordinator, not the canonical task
store or an assumed headless infrastructure executor. Functional failure could be
unavailable event/tunnel support; adoption failure could require leaving Inbox to
answer questions; opportunity cost could be maintaining both a new runner and Dot
without better outcomes. The weakest premise is account-specific end-to-end support.
The smallest next action is a real-email read/report round trip without mailbox or
repository mutation, before building the complete experience.

S&T selection:

| Step | Disposition | Parent | Sufficiency group | Owner | Review trigger |
|---|---|---|---|---|---|
| E6 | selected | root | DELEGATION-all | coordinator | Cannot complete evidence-backed delegated task |
| E6.1 | selected | E6 | DELEGATION-all | backend | Missing context / wrong project |
| E6.2 | selected | E6 | DELEGATION-all | execution | Dot transport or durable job capability fails |
| E6.3 | selected | E6 | DELEGATION-all | experience + verification | Questions/results fail to return to Inbox |

All three children remain necessary; E1/E2/E5 are supporting selected dependencies.
The Dot transport proof is the first gate within E6.2, not a substitute for it.
Self-hosted coordination is deferred, desktop-dependent dispatch is rejected.

Execution handoff: preserve private NAS state, 9950X execution, source authority,
keyboard/mail behavior and existing auth. Prove transport first, then a complete
real HiPhi task. Run every adversarial check above before release; none is waived
because a happy-path call succeeds. No operational changes made in this design step.
Human verification: account-native plugin/subscription consent if the product
requires it; exhaust existing authenticated setup before requesting interaction.

Sources inspected:
- https://developers.openai.com/plugins/build/mcp-events
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://learn.chatgpt.com/docs/dots/computers-and-apps
- home-infra/deploy/zero-poc/index.py
- homelab-infra/agent/README.md

## Execute — Initial Dot connection gate (2026-11-06, historical preparation)

Aim and selected approach remain E6.1/E6.2/E6.3: NAS-owned work and context,
Dot coordination, 9950X execution. No external issue, mail change, repair, tunnel
or subscription has been created in this execution step.

Execution checklist:
- Preserve NAS storage, private access, all existing mail operations and no desktop runtime dependency.
- Prove account-native Dot/event/tunnel setup, then one real email context/result round trip.
- Require repeat/reordered event, restart, stale-context and false-completion checks from Solution Space before completion.
- Stop dependent Dot integration at an unresolved identity/account gate; do not replace the selected coordinator silently.

Completed independent preparation: added get_mail_thread_page,
get_mail_message_page and get_mail_attachment_page to the image source in
home-infra/deploy/zero-poc/mail_context.py, registration in index.py and build
COPY in Index.Dockerfile. Not yet deployed to the MCP service. The opt-in
verify_mail_context.py ran against existing NAS Postgres from the existing worker,
with no synthetic messages or provider changes. It reconstructed a 210,781-character
body over 52 pages, a 65-message thread, and an attachment over 528 pages.
Exact body/bytes and message IDs matched; invalid bounds were rejected.

Risk status:
- Old tool truncation: retired by real-data reconstruction evidence above. This fails the tempting 25-message/12,000-character shortcut.
- Dot account access: triggered authentication gate. Browser Google sign-in succeeded, then OpenAI required identity verification. Browser help requested for that actual screen; no 1Password unlock requested by the agent.
- Combined event/tunnel/read/write proof, duplicate delivery, restart recovery, project mapping and verified completion: still pending, not retired.
- Desktop independence: design preserved; end-to-end runtime proof still pending.

Drift check: aligned; context preparation is within E6.1 while E6.2 account setup
waits. No claim of working delegation. The remaining gate is OpenAI identity
verification in BrowserOS before actual tunnel/account capability can be inspected.


## Execute — Deployment progress (2026-11-06)

Identity verification completed. Home Mail custom cloud plugin is installed with
Secure MCP Tunnel; the tunnel-client service runs on the 9950X LXC 212, NAS retains all
mail and Postgres state. A real Dot probe searched HiPhi monitoring, retrieved the
complete original thread/message through the new paginated tools, and returned
source identifiers. No mail/provider state was changed.

Deployed task SQL, immutable source/attachment snapshots, lease/revision-aware
callbacks and signed MCP Events adapter. Frontend built on the 9950X and deployed to
NAS with Delegate, source-linked status, questions/replies and evidence display.
Live page loads and shows Delegate beside real monitoring alerts. One real-mail
read-only task is prepared for the event round trip; subscription setup remains
under investigation because Dot initially saw stale plugin tools.

Checks: original context reconstruction above passed; additional live rollback
checks reconstructed 44,321 body characters and 25,321,960 attachment bytes, tested
ownership/idempotency/competing leases/stale revisions/questions/replies and
required result evidence. 38 event tests cover actual FastMCP coexistence,
independent Standard Webhooks signatures, DNS/TLS destination pinning, expiry,
retry caps, stable delivery identity and cursor preservation. Full repository
TypeScript checks retain baseline dependency/form failures; changed files have
no reported type errors, scoped lint and formatting pass.

Private bridge rejection now runs before proxy routing. The 9950X health returns 200;
desktop request returns 403. Readiness and service restart pass. Live signed
callback acceptance, event-triggered Dot execution, Inbox question/result return,
and actual project-job execution remain required before claiming E6 complete.

## Execute — Live results and review (2026-11-06)

The selected architecture is deployed: NAS task/context/event/job state, private
OpenAI tunnel on the 9950X, Dot cloud coordination, and Docker project execution on the 9950X.
Home Mail plugin is connected. No desktop relay or hosted CI is required.

Observed round trip: real HiPhi outage selected in Inbox; signed requested event
accepted and received by Dot; a fresh cloud run read the immutable source, claimed
work, posted progress and asked a question in Inbox. A clearly labeled integration
reply advanced revision 1 to 2. Its event resumed a cloud run, which returned source
identity/hash and evidence. Inbox displayed reported status and the owner acceptance
control; acceptance was exercised only on this integration test. A recovery email
is evidence of a report, never a verified repair.

Dot's initial long-lived tool snapshot was stale after the plugin gained task tools.
Fresh cloud executions see them. The existing subscription was updated to use that
path for every requested/reply event; no duplicate subscription was created. A new
recovery-message task was submitted without a manual Dot prompt to verify the
standing path. It completed automatically: requested 18:33:57 UTC, claimed 18:35:02,
reported 18:38:45. No manual Dot prompt or desktop tool relay advanced that task.

Actual execution proof: 9950X job 5487502f-b25c-424e-97bf-9374fe1f76ba exited 0,
read the public fork's commit and 802 tracked files, and preserved logs, result.json
and a 208,116,038-byte checkpoint in NAS Postgres. Checkpoint/result hashes matched.
Task db815490-2893-463a-ac58-38ade4703623 is reported with evidence. The existing
CLI credential was transferred privately for clone bootstrap, with NAS backup;
access to all three configured repos was verified without 1Password prompts.

Review adjusted four defects before completion: immutable snapshot row locking,
explicit project write grants, task lease binding/expiry, and NAS launch intent
before container start. A revoked task cannot start a precreated container, and
loss of all local scratch requires reconciliation rather than command replay.
The owner-session UI rechecks configured targets and creates exact project grants;
unchecked requests remain read-only. Unknown write targets fail 400 before creation.
The project list's workerd redirect-mode incompatibility was fixed and live GET 200
now returns all three targets. Redirects are rejected without being followed.

Verification: 38 protocol tests pass, plus offline worker recovery cases for lost
heartbeat, lost completion acknowledgement, lost scratch and revoked authority.
Live rollback checks cover original bodies/attachments, task ownership, idempotency,
leases/revisions, questions/replies, acceptance ownership/stale event rejection and
project scope enforcement. The frontend build succeeds on the 9950X. Scoped lint and
formatting pass; full TypeScript retains existing dependency/form failures with no
changed-file diagnostics. A repeated large rollback check held DDL locks briefly;
it was terminated and rolled back, normal reads recovered, and subsequent acceptance
checks used a small real source. Repeat DDL tests in isolation or maintenance time.

Risk retirement:
- Context truncation/staleness: exact full real body/thread/attachment reconstruction;
  immutable task source hashes and revision checks reject the summary-only shortcut.
- Duplicate/reordered work: stable request/event/job keys, cursor replay tests,
  competing claims and lost launch/ack recovery reject blind command replay.
- False completion: reported, owner accepted and independently verified are separate;
  process exit and recovery notifications cannot become verified repairs.
- Wrong project/authority: exact source references, configured project IDs, owner
  checks and explicit write grants reject guessed targets and email-derived authority.
- Transport/account: real signed callback and Dot context/question/result passed;
  standing fresh-event run also passed without intervention (about five minutes).
- Desktop dependence: runtime services and all durable storage run on the 9950X/NAS;
  actual cloud callbacks and project execution use those services.
- Subscription/executor loss: persisted subscriptions/cursors/expiry, retry bounds,
  service restarts and durable job launch reconciliation are covered. Automatic
  subscription renewal across a real day remains an operational observation;
  queued work stays visible instead of being marked complete.

No issue or repair was invented as proof. Further incident-specific changes require
an explicit delegated instruction and the mapped project; tests here changed no mail.


Delivered: context callback, durable task events, cloud dispatch, Inbox progress and
questions/replies, source-backed results, explicit owner acceptance, and 9950X job
execution with NAS artifacts. No incident-specific repair was performed. Operational
limits: cloud delegation is asynchronous (observed about five minutes); project jobs
use configured repositories and container images; pushes/issues need the coordinator's
GitHub integration, while clone credentials stay in bootstrap only. Arbitrary attachment
OCR/parsing and Exchange Online Archive remain earlier mail-index limitations.
