# lm-evaluation-harness

Verified: run, 2026-10-13. Against the live dev server at `127.0.0.1:4010` (`main`, model `fast`, `max_tokens` 1024), with the pinned harness [lm-eval 0.4.13](https://pypi.org/project/lm-eval/0.4.13/) from PyPI. Two model types ran: `local-completions` (legacy `/v1/completions`) and `local-chat-completions` (`/v1/chat/completions`). On a tiny generate-until task with `--limit 2`, `local-completions` scored `exact_match` 1.0. `local-chat-completions` scored 1.0 on the rerun and 0.5 on the first run (one empty answer, see the table and the reasoning gotcha).

lm-evaluation-harness (EleutherAI) runs benchmark tasks against any OpenAI-compatible endpoint. The `local-completions` and `local-chat-completions` model types send plain HTTP requests, so plugboard answers them like any other client.

## Setup

Install into a venv, not the system Python. The `api` extra adds the HTTP model classes (`tenacity`):

```sh
uv venv venv --python 3.12
uv pip install --python venv/bin/python "lm-eval[api]==0.4.13"
```

The venv is about 450 MB. The first install also fills uv's cache, so point `UV_CACHE_DIR` at a scratch folder if disk is tight, and delete both when done.

## Task

Use a `generate_until` task. It needs no logprobs, which plugboard does not serve (see below). This one reads three questions from a local JSONL file, so it downloads nothing. `tasks/plugboard_tiny_gen.yaml`:

```yaml
task: plugboard_tiny_gen
dataset_path: json
dataset_kwargs:
  data_files:
    test: tasks/tiny.jsonl        # relative to the directory you run lm_eval from
test_split: test
output_type: generate_until
doc_to_text: "Q: {{question}}\nA:"
doc_to_target: "{{answer}}"
generation_kwargs:
  until:
    - "\n"
  do_sample: false
  temperature: 0.0
metric_list:
  - metric: exact_match
    aggregation: mean
    higher_is_better: true
    ignore_case: true
    ignore_punctuation: false
metadata:
  version: 1.0
```

`tasks/tiny.jsonl` has one `{"question": ..., "answer": ...}` object per line. The run used "Reply with exactly the word: pong" (answer `pong`), "What is 2 + 2? Answer with the number only." (answer `4`) and one more question.

## Run

The key goes in `OPENAI_API_KEY` for the process only. It is not in `--model_args`, so it stays out of the printed config. Replace the placeholder path with your own.

```sh
export OPENAI_API_KEY=<app key>
HF_HUB_OFFLINE=1 venv/bin/lm_eval run \
  --model local-completions \
  --model_args "model=fast,base_url=http://127.0.0.1:4010/v1/completions,num_concurrent=1,max_retries=0,tokenizer_backend=None,max_gen_toks=1024" \
  --include_path tasks --tasks plugboard_tiny_gen --limit 2 --batch_size 1 \
  --output_path out --log_samples
```

For the chat model type, use `--model local-chat-completions`, `base_url=http://127.0.0.1:4010/v1/chat/completions` and add `--apply_chat_template`.

Results, from the run:

| Model type | Requests | Result |
|---|---|---|
| `local-completions` | `/v1/completions`, 2 requests | `exact_match` 1.0. Samples: `pong`, `4` |
| `local-chat-completions` | `/v1/chat/completions`, `--apply_chat_template`, 2 requests | First run `exact_match` 0.5 with one `API returned null content` warning (the empty answer is inferred from the warning, since that run did not log samples). Rerun with samples logged: 1.0 (`pong`, `4`). See the reasoning gotcha below |

`--batch_size 1` is there on purpose. Inferred from the code, not run: a larger batch makes the harness send a prompt array, and plugboard counts prompts times `n` against `maxN` (1 by default). A batch of two or more would then get `400 too_many_choices` on a default server. Keep the batch at 1 unless the operator has raised `maxN`.

## Loglikelihood tasks do not run

Multiple-choice tasks (hellaswag, MMLU, ARC in their default form) use `output_type: loglikelihood`. Those score each choice by its log probability, so they request `logprobs` with `echo`. Plugboard does not serve logprobs. A request with `logprobs` gets a 400 and the harness stops:

```json
{"error":{"message":"logprobs is not supported","type":"invalid_request_error","param":"logprobs","code":"unsupported_parameter"}}
```

Use generate-until tasks (free-text answers scored by `exact_match`, `f1` or a regex filter). A generate-until task reads the answer text, not the probabilities. Loglikelihood scores are not measured by plugboard, so no task built on them can be reported as a result here.

## Gotchas

- **`n` is refused on `main`.** The dev server runs with `maxN` 1. A request with `n: 2` gets `400 too_many_choices` (`n=2 is above the limit of 1 (option maxN; each choice is a full model call)`). The runs above sent one choice per request and did not hit it. A task or option that sets `n` above 1 fails until the operator raises `maxN`.
- **`tokenizer_backend=None` skips the tokenizer.** The default downloads a Hugging Face tokenizer, which needs network. With `None` the harness does not check the context length (`Tokenized requests are disabled`), so a long prompt is the server's problem.
- **EOS warning is harmless here.** `Cannot determine EOS string to pass to stop sequence` appears because no tokenizer is loaded. The `until` stop sequence still goes to plugboard. Set `eos_string` in `--model_args` if a task relies on an end-of-text marker.
- **Reasoning model: `null` content.** `fast` is a reasoning model. Probably, a request whose reasoning uses the whole token budget comes back with no visible text (inferred from the warning). The harness then records the placeholder `LMEVAL_MODEL_NONE_ANSWER_PLACEHOLDER` and scores the item wrong. That happened once in two chat requests, and not on the rerun. 1024 was not always enough: the one empty answer came at `max_gen_toks` 1024. Raise it (try 2048 or more) or use a non-reasoning alias, and check `resps` in the samples file when a score looks low. One run proves little on a sampled model: use the samples, not the headline number.
- **`--limit` is for testing.** The harness warns that metrics from a limited run are not real results. The numbers above are a smoke test of the wire path, not a benchmark score.
- **`--log_samples` writes the prompts and answers** to `output_path`. Keep that folder out of the repo.

## Not verified

- Full benchmark tasks.
- A harness run that sends `n` above 1. Neither run did, so the `n` path through an eval client is not checked live. Doing that needs a server with `maxN` 4 and a setting that gives `n`.
- Model-graded tasks (they need a grader, see [promptfoo](promptfoo.md) for the same caveat).
- `lm-eval` newer than 0.4.13.
