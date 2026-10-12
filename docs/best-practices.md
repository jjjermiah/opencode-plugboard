# OpenSSF Best Practices: passing-level answers

This page is the answer sheet for the passing level of the [OpenSSF Best Practices badge](https://www.bestpractices.dev/). The owner registers the project at bestpractices.dev and pastes these answers. Nothing here is registered or claimed yet.

The badge is self-certified: the project answers each criterion and the site accepts the answers. Each answer below is the project's own statement, with the evidence it points at. Where an answer depends on something the maintainer must confirm, it says so.

Evidence links point at `main`. Repository: <https://github.com/jjjermiah/opencode-plugboard>.

## Status key

- **Met**: the answer is true today, with the evidence given.
- **Met (confirm)**: true today, but the owner should check the evidence before pasting.
- **N/A**: not applicable, with the justification to paste.
- **Pending**: not yet true; the answer depends on time or a first run. Do not claim it until it is.

## Basics

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `description_good` | Met | The README says what plugboard does (serves OpenAI, Anthropic and Gemini compatible APIs from an OpenCode server). <https://github.com/jjjermiah/opencode-plugboard/blob/main/README.md> |
| `interact` | Met | Install and contribute steps are in the README and CONTRIBUTING; feedback goes through issues. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md> |
| `contribution` | Met | CONTRIBUTING explains that changes go through pull requests, with commits, required checks and an issue. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#pull-requests> |
| `contribution_requirements` | Met | Code rules, freeze-safety rules, commit format and the test policy are in CONTRIBUTING. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#code-rules> |
| `floss_license` | Met | MIT. |
| `floss_license_osi` | Met | MIT is OSI-approved. |
| `license_location` | Met | Top-level LICENSE. <https://github.com/jjjermiah/opencode-plugboard/blob/main/LICENSE> |
| `documentation_basics` | Met | Documentation site: <https://jjjermiah.github.io/opencode-plugboard/>; sources under `docs/`. |
| `documentation_interface` | Met | The configuration reference (inputs, options, HTTP interface) is in `docs/configuration.md`, and the endpoints are in the docs. <https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md> |
| `sites_https` | Met | The repository, the docs site (GitHub Pages) and the npm package are served over HTTPS. |
| `discussion` | Met | GitHub Issues: searchable, each issue has a URL, anyone with a GitHub account can take part, no proprietary client. <https://github.com/jjjermiah/opencode-plugboard/issues> |
| `english` | Met | Documentation and issues are in English. |
| `maintained` | Met | Active: commits and releases in the last days. <https://github.com/jjjermiah/opencode-plugboard/commits/main> |

## Change control

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `repo_public` | Met | Public repository. <https://github.com/jjjermiah/opencode-plugboard> |
| `repo_track` | Met | Git records what changed, who and when. |
| `repo_interim` | Met | Commits between releases are kept on `main` (not only release tags). |
| `repo_distributed` | Met | Git. |
| `version_unique` | Met | Each release has a unique version in `package.json` and a tag `vX.Y.Z`. <https://github.com/jjjermiah/opencode-plugboard/tags> |
| `version_semver` | Met | Semantic Versioning. |
| `version_tags` | Met | Git tags, one per release. |
| `release_notes` | Met | Curated, human-readable notes in CHANGELOG.md for each release, shown on the GitHub release. The commit list under "The full story" is generated and sits below the curated notes. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md> |
| `release_notes_vulns` | N/A | No publicly known CVE has been fixed in a plugboard release so far. Re-check before each release and name any that appear. |

## Reporting

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `report_process` | Met | Bug reports go through GitHub Issues, with issue templates. <https://github.com/jjjermiah/opencode-plugboard/issues/new/choose> |
| `report_tracker` | Met | GitHub Issues. |
| `report_responses` | Pending | The project MUST acknowledge a majority of bug reports from the last 2 to 12 months. The repository was created on 2026-10-11, so there is no window yet, and this criterion does not allow N/A. Do not claim it until reports exist and a majority are answered. Check the site's help text for how an empty window is scored before answering. |
| `enhancement_responses` | Pending | Same as `report_responses`: revisit when there is a window. |
| `report_archive` | Met | Issues are public and searchable. |
| `vulnerability_report_process` | Met | SECURITY.md publishes the process. <https://github.com/jjjermiah/opencode-plugboard/blob/main/SECURITY.md> |
| `vulnerability_report_private` | Met (confirm) | Private vulnerability reporting is enabled on the repository (confirmed through the API on 2026-10-12). <https://github.com/jjjermiah/opencode-plugboard/security> |
| `vulnerability_report_response` | Met | SECURITY.md: acknowledge within 7 days, fix a confirmed issue within 30 days. |

## Quality

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `build` | Met | `bun run build:tui` rebuilds the compiled TUI entry from source; `bun run typecheck` and `bun test` check it. <https://github.com/jjjermiah/opencode-plugboard/blob/main/package.json> |
| `build_common_tools` | Met | Bun and npm. |
| `build_floss_tools` | Met | Bun is MIT-licensed. |
| `test` | Met | `bun test`, documented in CONTRIBUTING and test/README. <https://github.com/jjjermiah/opencode-plugboard/blob/main/test/README.md> |
| `test_invocation` | Met | `bun test` (the standard Bun invocation). |
| `test_most` | Met | Coverage floor on lines is 98.2% and on functions 93.6%, enforced in CI. <https://github.com/jjjermiah/opencode-plugboard/blob/main/.github/floors/coverage-floor.json> |
| `test_continuous_integration` | Met | CI runs typecheck, tests and the coverage gate on every push and pull request. <https://github.com/jjjermiah/opencode-plugboard/blob/main/.github/workflows/ci.yml> |
| `test_policy` | Met | CONTRIBUTING: add or change a test with every behaviour change; known bugs get a failing test. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#tests> |
| `tests_are_added` | Met | Test-count floors only go up; the commit that ratchets them is in the history (for example "chore(tests): ratchet test-count and coverage floors"). |
| `tests_documented_added` | Met | Same policy, documented in CONTRIBUTING. <https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#tests> |
| `warnings` | Met | `tsconfig.json` sets `strict`, `noUnusedLocals` and `noUnusedParameters`, and `bun run typecheck` fails on the diagnostics they raise. |
| `warnings_fixed` | Met | CI's typecheck step fails on any diagnostic these flags raise, so they are fixed before merge. |
| `warnings_strict` | Met | The strict flags above. |

## Security

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `know_secure_design` | Met (confirm) | The maintainer's statement; the owner confirms before pasting. |
| `know_common_errors` | Met (confirm) | The maintainer's statement; the owner confirms before pasting. The threat model is in SECURITY.md. |
| `crypto_published` | N/A | Plugboard implements no cryptographic protocol or algorithm. It passes bearer keys to OpenCode and serves plain HTTP; TLS is the operator's job, see `docs/remote-access.md`. |
| `crypto_call` | N/A | No cryptographic functions are implemented in plugboard. |
| `crypto_floss` | N/A | No cryptographic functionality depends on non-FLOSS software. |
| `crypto_keylength` | N/A | No keys are generated; keys are configured by the operator. |
| `crypto_working` | N/A | No cryptographic algorithms are used by the default configuration. |
| `crypto_weaknesses` | N/A | No key agreement protocol is implemented. |
| `crypto_pfs` | N/A | No key agreement protocol is implemented. |
| `crypto_password_storage` | N/A | Plugboard stores no passwords; keys are compared as configured secrets. |
| `crypto_random` | Met (confirm) | Any random identifiers come from the platform's cryptographic generator. The owner checks the source before pasting. |
| `delivery_mitm` | Met | Releases reach users through npm over HTTPS, with provenance. The source is on GitHub over HTTPS. |
| `delivery_unsigned` | Met | No hash is fetched over HTTP. |
| `vulnerabilities_fixed_60_days` | Met (confirm) | No publicly known unpatched medium-or-higher vulnerability is known at the time of writing (OSV query). The owner re-checks before pasting. |
| `vulnerabilities_critical_fixed` | Met | No known critical vulnerability is open. |
| `no_leaked_credentials` | Met (confirm) | A history scan with gitleaks found no credentials (run by the maintainer, not in CI). Secret scanning and push protection are enabled on the repository. Re-run before pasting. |

## Analysis

| Criterion | Status | Answer to paste, with evidence |
| --- | --- | --- |
| `static_analysis` | Pending | CodeQL (`javascript-typescript`) runs on push, pull request and weekly. <https://github.com/jjjermiah/opencode-plugboard/blob/main/.github/workflows/codeql.yml>. Paste this as Met after the first CodeQL run on `main` has completed. `tsc` alone does not count. |
| `static_analysis_common_vulnerabilities` | Pending | The CodeQL default security queries look for common vulnerabilities; the same first run applies. |
| `static_analysis_fixed` | Pending | Confirmed alerts are fixed before release; check the code-scanning alerts after the first run. |
| `static_analysis_often` | Met | CodeQL runs on every push to main and every pull request, and weekly. |
| `dynamic_analysis` | N/A | No dynamic analysis tool is applied. Property-based tests (fast-check) run in the unit suite. |
| `dynamic_analysis_unsafe` | N/A | The project is written in TypeScript, a memory-safe language. |
| `dynamic_analysis_enable_assertions` | N/A | No dynamic analysis tool is applied. |
| `dynamic_analysis_fixed` | N/A | No dynamic analysis tool is applied. |

## Before pasting

1. Register at <https://www.bestpractices.dev/> and create the project.
2. Paste the answers above, filling each "Met (confirm)" after checking it.
3. Leave `report_responses`, `enhancement_responses`, `static_analysis`, `static_analysis_common_vulnerabilities` and `static_analysis_fixed` as unanswered until they are true.
4. Once the project has an id, add the badge to the README (see the commented line near the top of README.md).
