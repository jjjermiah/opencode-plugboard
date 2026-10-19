# lm-evaluation-harness

EleutherAI's benchmark harness, with its `local-completions` and `local-chat-completions` model types.

## Install

```sh
uv venv venv --python 3.12
uv pip install --python venv/bin/python "lm-eval[api]"
```

## Run

Use a `generate_until` task; plugboard serves no logprobs (see Limits).

```sh
export OPENAI_API_KEY=<your plugboard key>
venv/bin/lm_eval run \
  --model local-completions \
  --model_args "model=fast,base_url=http://127.0.0.1:4010/v1/completions,num_concurrent=1,tokenizer_backend=None,max_gen_toks=2048" \
  --tasks <your generate_until task> --batch_size 1
```

For chat, use `--model local-chat-completions`, `base_url=http://127.0.0.1:4010/v1/chat/completions` and `--apply_chat_template`. `tokenizer_backend=None` skips downloading a Hugging Face tokenizer (the harness then doesn't check context length).

A small task with a local dataset:

```yaml
task: plugboard_tiny_gen
dataset_path: json
dataset_kwargs:
  data_files:
    test: tasks/tiny.jsonl
test_split: test
output_type: generate_until
doc_to_text: "Q: {{question}}\nA:"
doc_to_target: "{{answer}}"
generation_kwargs:
  until: ["\n"]
  do_sample: false
  temperature: 0.0
metric_list:
  - metric: exact_match
    aggregation: mean
    higher_is_better: true
    ignore_case: true
```

## Limits

- **No loglikelihood tasks.** Multiple-choice tasks scored by log probability (default hellaswag, MMLU, ARC) request `logprobs`, which plugboard refuses with 400 `unsupported_parameter`.
- **Batching.** A batch above 1 sends a prompt array, which counts against `maxN` (default 1). Keep `--batch_size 1` or raise `maxN`.
- **Reasoning models** can spend the whole token budget thinking and return no text, which scores as wrong. Raise `max_gen_toks` or use a non-reasoning model, and check `resps` in the samples file when a score looks low.
