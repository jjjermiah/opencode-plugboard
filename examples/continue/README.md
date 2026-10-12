# Continue with plugboard

A Continue `config.yaml` with two plugboard models, one on Chat Completions and one on Responses. The client guide is [docs/clients/continue.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/continue.md), which has the plugboard options (app `continue`, alias `fast`).

- `config.yaml`: copy into Continue's config and replace the key placeholder. The JSON form is deprecated in Continue, so it is not included.

Pick the `fast (chat)` or `fast (responses)` model in Continue, then ask it a question that needs a tool, such as reading a file, to exercise the tool path.

Not run against plugboard yet.
