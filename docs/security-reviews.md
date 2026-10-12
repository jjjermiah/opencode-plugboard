# Security reviews

These were AI-assisted reviews (GitHub Copilot GPT-6 Luna acting as reviewers), not a human or third-party audit.

The maintainer ([@jjjermiah](https://github.com/jjjermiah)) read each finding, decided what to do with it and accepted the change. A model cannot be accountable for a release, so the maintainer is. No badge or certification is based on these reviews.

## What was reviewed

- **Date:** 2026-10-12 (the findings were filed that day and fixed in 0.21.0 and later releases).
- **Three reviews**, each from a different lens:
  - security and legal (licences, notices, trademarks, key handling, request limits, supply chain),
  - architecture and bugs (runtime, cache, streaming, cancellation),
  - product and developer experience (startup errors, readiness, docs, packaging, CI).
- **Output:** one GitHub issue per finding, labelled with the reviewer's lens where the issue says so. Each fix is a commit that closes or refers to its issue. The commit mapping below is by commit subject; where a finding has no commit, the issue says so.

Finding numbers run #152 to #168. Issue states below are as of writing; the links are the source of truth.

## Security and legal

| Issue | Finding | State | Fixed in |
| --- | --- | --- | --- |
| [#152](https://github.com/jjjermiah/opencode-plugboard/issues/152) | Removing the last key left the old generation accepting it (architecture lens) | Closed | [823b725](https://github.com/jjjermiah/opencode-plugboard/commit/823b725) |
| [#156](https://github.com/jjjermiah/opencode-plugboard/issues/156) | Request bodies were buffered before any limit applied | Closed | [497341b](https://github.com/jjjermiah/opencode-plugboard/commit/497341b) |
| [#157](https://github.com/jjjermiah/opencode-plugboard/issues/157) | The host-bump workflow held write access in the job that ran the newest host code | Closed | [b78f13a](https://github.com/jjjermiah/opencode-plugboard/commit/b78f13a) |
| [#162](https://github.com/jjjermiah/opencode-plugboard/issues/162) | The compat request log kept API key headers and `?key=` in clear text | Closed | [2fc13e2](https://github.com/jjjermiah/opencode-plugboard/commit/2fc13e2) |
| [#163](https://github.com/jjjermiah/opencode-plugboard/issues/163) | Third-party notice missing for the vendored OpenAI and Gemini schema fixtures (legal lens) | Closed | [fbc1436](https://github.com/jjjermiah/opencode-plugboard/commit/fbc1436) |
| [#164](https://github.com/jjjermiah/opencode-plugboard/issues/164) | README needed a non-affiliation and trademark line (legal lens) | Closed | [fb89d02](https://github.com/jjjermiah/opencode-plugboard/commit/fb89d02) |
| [#165](https://github.com/jjjermiah/opencode-plugboard/issues/165) | Transitive dependencies can resolve differently per install, since the package ships no lock file | Open | none yet |
| [#158](https://github.com/jjjermiah/opencode-plugboard/issues/158) | History is kept forever by default (both staff reviews) | Fixed in 0.25.0 | `history.maxAgeDays` defaults to 30; `0` opts out |

## Architecture and bugs

| Issue | Finding | State | Fixed in |
| --- | --- | --- | --- |
| [#153](https://github.com/jjjermiah/opencode-plugboard/issues/153) | Streams and cache capture held unbounded memory | Closed | [4b77d6e](https://github.com/jjjermiah/opencode-plugboard/commit/4b77d6e) |
| [#154](https://github.com/jjjermiah/opencode-plugboard/issues/154) | A cache hit could take a concurrency slot and return 429 | Closed | [fb19893](https://github.com/jjjermiah/opencode-plugboard/commit/fb19893) |
| [#155](https://github.com/jjjermiah/opencode-plugboard/issues/155) | A session created after the client aborted was never cleaned up | Closed | [dde2b1e](https://github.com/jjjermiah/opencode-plugboard/commit/dde2b1e) |

The architecture issues without a lens label (#153 to #155) are grouped here by subject.

## Product and developer experience

| Issue | Finding | State | Fixed in |
| --- | --- | --- | --- |
| [#159](https://github.com/jjjermiah/opencode-plugboard/issues/159) | An invalid config left the plugin silently inactive | Closed | [65b48df](https://github.com/jjjermiah/opencode-plugboard/commit/65b48df) |
| [#160](https://github.com/jjjermiah/opencode-plugboard/issues/160) | `/healthz` said ok before the backend could serve; no readiness check | Closed | [f0c3a34](https://github.com/jjjermiah/opencode-plugboard/commit/f0c3a34) |
| [#161](https://github.com/jjjermiah/opencode-plugboard/issues/161) | Docs contradicted the code (stop sequences, concurrency limits, image support) | Closed | [ecdd72a](https://github.com/jjjermiah/opencode-plugboard/commit/ecdd72a) |
| [#166](https://github.com/jjjermiah/opencode-plugboard/issues/166) | A consumer `tsc` over the packed package failed with TS7016 for `escape-html` | Closed | [f1c5292](https://github.com/jjjermiah/opencode-plugboard/commit/f1c5292) |
| [#167](https://github.com/jjjermiah/opencode-plugboard/issues/167) | The docs site was only built on push to main, so broken pages showed after merge | Closed | [95f6c9e](https://github.com/jjjermiah/opencode-plugboard/commit/95f6c9e) |
| [#168](https://github.com/jjjermiah/opencode-plugboard/issues/168) | Remote access needed a guide: plain HTTP on non-loopback binds, TLS and tunnels (product and security) | Closed | [fbab4cc](https://github.com/jjjermiah/opencode-plugboard/commit/fbab4cc) |

The release that answered these reviews is [0.21.0, "Answers to the Reviewers"](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md), in the changelog.

## Live matrix findings (after the reviews)

A first run against real providers found the issues below. They are not from the staff reviews, but they were filed and fixed the same way.

| Issue | Finding | State | Fixed in (inferred from commit subjects) |
| --- | --- | --- | --- |
| [#169](https://github.com/jjjermiah/opencode-plugboard/issues/169) | `/v1/completions` ignored `response_format` with `json_schema` | Closed | [8ed3df4](https://github.com/jjjermiah/opencode-plugboard/commit/8ed3df4) |
| [#170](https://github.com/jjjermiah/opencode-plugboard/issues/170) | Claude with a tool plus `json_schema` often ended without the respond tool (502) | Closed | [b0acb3a](https://github.com/jjjermiah/opencode-plugboard/commit/b0acb3a) |
| [#171](https://github.com/jjjermiah/opencode-plugboard/issues/171) | A generic `provider_unavailable` hid the provider's real error | Closed | [01f517d](https://github.com/jjjermiah/opencode-plugboard/commit/01f517d) |
| [#172](https://github.com/jjjermiah/opencode-plugboard/issues/172) | An empty answer with tools plus `json_schema` came back as a 200 | Closed | [3bcef84](https://github.com/jjjermiah/opencode-plugboard/commit/3bcef84) |
| [#173](https://github.com/jjjermiah/opencode-plugboard/issues/173) | Structured output on Responses and Gemini needed a text fallback and a 502 for a missing answer | Closed | [d7d0f8f](https://github.com/jjjermiah/opencode-plugboard/commit/d7d0f8f), [b7d19d1](https://github.com/jjjermiah/opencode-plugboard/commit/b7d19d1), [e93c9f1](https://github.com/jjjermiah/opencode-plugboard/commit/e93c9f1), [543a541](https://github.com/jjjermiah/opencode-plugboard/commit/543a541) |

## Earlier review: 0.2.0

Before these, a fresh reviewer read the 0.1.0 code cold and found eighteen things to fix. None needed a redesign; most were places where the code promised more than it did. The fixes shipped as 0.2.0, "Second Opinion", in [CHANGELOG.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md).

## Still open

- [#158](https://github.com/jjjermiah/opencode-plugboard/issues/158): the default history retention was unlimited. Fixed in 0.25.0: 30 days by default, and `history.maxAgeDays: 0` is the explicit opt-out.
- [#165](https://github.com/jjjermiah/opencode-plugboard/issues/165): transitive dependency drift under a pinned plugboard version. Being investigated.

## What this is not

- Not a human security audit, a penetration test or a certification.
- Not a code review in the sense of the OpenSSF Scorecard `Code-Review` check, which does not count AI reviews. The project still has one maintainer.
- Not a basis for any badge. See [SECURITY.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/SECURITY.md) for how to report a vulnerability, and the response targets.
