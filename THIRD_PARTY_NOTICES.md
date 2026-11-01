# Third-party notices

This file lists third-party material in the repository and the terms that cover it. It does not change the project license, which is in [LICENSE](LICENSE). The material below is used only by the test suite. It is not in the npm package (`files` in `package.json`).

## Vendored schema fixtures

`test/fixtures/specs/vendor.ts` writes two fixtures, and `test/fixtures/specs/vendor-anthropic.ts` derives a third from the Anthropic SDK's types. Each keeps only the schemas reachable from its response roots, drops documentation keys, and rewrites `$ref`s. Each file records its source URL and retrieval date in `$source` and `$retrieved`.

| Fixture | Derived from | Retrieved | Terms |
| --- | --- | --- | --- |
| `test/fixtures/specs/openai.json` | `openapi.yaml` in [openai/openai-openapi](https://github.com/openai/openai-openapi), `https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml` | 2026-10-11 | MIT, below |
| `test/fixtures/specs/gemini.json` | Google API discovery document, `https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta` | 2026-10-11 | Unclear, see below |
| `test/fixtures/specs/anthropic.json` | Type declarations of `@anthropic-ai/sdk` 1.3.0 (`resources/messages/messages.d.ts`, `resources/shared.d.ts`), https://www.npmjs.com/package/@anthropic-ai/sdk/v/1.3.0 | 2026-11-01 | Apache-2.0, below |

### openai/openai-openapi (MIT)

Source: https://github.com/openai/openai-openapi (license file: https://raw.githubusercontent.com/openai/openai-openapi/master/LICENSE, fetched 2026-10-11).

```
The MIT License

Copyright (c) OpenAI (https://openai.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @anthropic-ai/sdk (Apache-2.0)

Source: https://github.com/anthropics/anthropic-sdk-typescript (the package's `LICENSE`, as shipped in version 1.3.0). The full license, including Anthropic's copyright notice, is copied verbatim to [`test/fixtures/specs/anthropic.LICENSE`](test/fixtures/specs/anthropic.LICENSE). The derived schema is modified to retain only response-reachable types and omit documentation.

### Google API discovery document (terms unclear)

`test/fixtures/specs/gemini.json` is derived from the public Gemini API discovery document. The document carries no license of its own, and no open-source license is claimed for it here.

- The Google APIs Terms of Service (https://developers.google.com/terms, last modified 2021-11-09) govern use of the APIs. Section 5(a) says content accessible through the APIs may be subject to intellectual property rights and may not be used unless the owner licenses it or the law permits it. Section 5(e) forbids making permanent copies of content returned from the APIs unless the content owner or the law permits it.
- Google's Developers Site Policies (https://developers.google.com/terms/site-policies) license the documentation pages under CC BY 4.0 and code samples under Apache 2.0. It is not clear that they cover a discovery document.
- Whether a vendored, reduced discovery document falls under Section 5 is not settled by these terms. This is an open question for the project owner: keep the fixture, replace it with a schema written in this repository, or remove it and drop the Gemini conformance check.
