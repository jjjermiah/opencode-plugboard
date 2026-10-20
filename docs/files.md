# Files API

Plugboard keeps files per app, so a request can name a file by id instead of carrying its bytes every time. Upload once, then use the file in Chat Completions, Responses, Messages or Gemini. The three Files APIs share one store: a file uploaded through the OpenAI SDK can be named in a Gemini request.

Files are stored on the OpenCode server's host storage, so they survive a restart. An app sees only its own files. Another app's id gets the same 404 as an id that never existed.

## What is stored

Plugboard keeps only what it can send to a model exactly as it sends inline data:

| Kind | Accepted as | How the model gets it |
| --- | --- | --- |
| Image | PNG, JPEG, GIF, WebP | An image, as a `data:` URL image part. |
| PDF | `application/pdf` | A PDF file part, as a `data:application/pdf` URL. |
| Text | `text/*` or JSON, as UTF-8, up to 4 MiB | A text part with the file's content. |

The type comes from the bytes. An image or a PDF is told by its first bytes, whatever name or `Content-Type` the upload carried: a PNG called `notes.txt` is stored as `image/png`. Text has no signature, so it is accepted only when the upload also declares a text type (`text/*`, `application/json`, read from the file part's own `Content-Type` header, whatever its file name) or has a text extension (`.txt`, `.md`, `.csv`, `.json`, ...), and its bytes are valid UTF-8 with no NUL byte. JSON must parse. Anything else is a 400 at upload that names the accepted kinds, so a file never fails later in a request. An empty file is a 400.

## Limits

| Limit | Value |
| --- | --- |
| One file | The app's body cap (`limits.maxBodyBytes`, 32 MiB by default) and never more than 32 MiB. Text and JSON: 4 MiB. |
| Files per app | 1000 |
| Bytes per app | 1 GiB |
| Kept for | The app's `sessions.maxAgeDays`, 30 days when unset or `0`. The same rule as [stored responses](responses.md#stored-responses). |
| Files in one request | 32, and 50 MB together (an image or a PDF counts as its base64 size, a text file as its bytes) |

An upload past the file or byte limit is a 400 (`file_limit_exceeded`, `file_storage_full`). Plugboard never deletes a file to make room, because a caller may still be using it. The count and byte checks and the write that follow are one step per app, so uploads in flight together never leave an app past either limit. The saves of one app run one at a time, and the queue behind the running one is bounded: at most 8 waiting, and at most 64 MiB held by the running and waiting saves together (an app with no save running takes any upload). An upload past either bound is a 429 `file_saves_busy` at once, with `Retry-After`, in the API's own error shape. An upload that is waiting leaves the queue when its request ends (a timeout or a disconnect) and its bytes are released; the save that is running keeps its turn until its write ends, because that write can still complete. The files a request names together are checked against the 50 MB on their sizes alone, before any file's bytes are read, and a request over it is a 400 `files_too_large`. An upload is read under the same body admission as any request body (`limits.maxBodyBytesInFlight`, `limits.bodyReadTimeoutMs`), so a large upload cannot take more memory than the cap. The limits above are fixed. `apps.<name>.endpoints` can list `files` to allow or refuse every Files route (see [Endpoint names](configuration.md#endpoint-names)).

## OpenAI

`/v1/files` takes OpenAI's shapes unless the request is Anthropic's (below).

| Route | What it does |
| --- | --- |
| `POST /v1/files` | Multipart form with `file` and `purpose` (`user_data`, `assistants`, `vision` or `evals`; no purpose changes how a file is used). Answers the file object: `id`, `object: "file"`, `bytes`, `created_at`, `expires_at`, `filename`, `purpose`, `status`. |
| `GET /v1/files` | The app's files. `purpose`, `limit` (1 to 10000, default 10000), `after` and `order` (`asc` or `desc`, default `desc`). Answers `{object: "list", data, first_id, last_id, has_more}`. |
| `GET /v1/files/{id}` | One file object. |
| `GET /v1/files/{id}/content` | The bytes, with the stored type and `Content-Disposition: attachment`. |
| `DELETE /v1/files/{id}` | `{id, object: "file", deleted: true}`. |

An id is `file-` and 32 hex characters. An unknown, deleted, expired or other app's id is a 404 `invalid_request_error` with the message `No such File object: <id>`. A file named in a request (`file_id` on Chat Completions and Responses) that the app does not hold is the same 404 with the same body.

Use a file in a request:

```ts
const file = await client.files.create({ file: fs.createReadStream("report.pdf"), purpose: "user_data" })

// Chat Completions
await client.chat.completions.create({
  model: "fast",
  messages: [{ role: "user", content: [{ type: "text", text: "Summarize it." }, { type: "file", file: { file_id: file.id } }] }],
})

// Responses
await client.responses.create({
  model: "fast",
  input: [{ role: "user", content: [{ type: "input_text", text: "Summarize it." }, { type: "input_file", file_id: file.id }] }],
})
```

On Chat Completions the `file` part takes any stored file: an image becomes an image part, text becomes a text part. On Responses, `input_file` takes a PDF or text file and `input_image` takes an image (a PDF as `input_image` is a 400 `invalid_file`). A stored response keeps the `file_id`, not the bytes, so `previous_response_id` replays the file; if the file was deleted by then, the chained request is a 404.

## Anthropic

A request that sends `anthropic-version` or `anthropic-beta` (every Anthropic SDK call does) gets Anthropic's shapes on the same paths, as `GET /v1/models` does. `x-api-key` authenticates. The `?beta=true` query is accepted and ignored.

| Route | What it does |
| --- | --- |
| `POST /v1/files` | Multipart form with `file`. Answers `{id, type: "file", filename, mime_type, size_bytes, created_at, downloadable, expires_at}`. `downloadable` is `true`: unlike Anthropic's own API, an uploaded file can be downloaded. `expires_in_seconds` is ignored; every file expires with the app's retention. |
| `GET /v1/files` | Newest first. `limit` (1 to 1000, default 20), `page` (the `next_page` of an earlier list), `after_id`, `before_id`, `ids` (up to 100). Answers `{data, first_id, last_id, has_more, next_page}`. |
| `GET /v1/files/{id}`, `GET /v1/files/{id}/content` | Metadata, and the bytes as an attachment. |
| `DELETE /v1/files/{id}` | `{id, type: "file_deleted"}`. |

Errors use Anthropic's body: a missing file is a 404 `not_found_error` with the message `File not found: <id>`, on these routes and for a `file_id` in a Messages request.

```py
file = client.beta.files.upload(file=("report.pdf", open("report.pdf", "rb"), "application/pdf"))
client.beta.messages.create(
    model="fast", max_tokens=1024, betas=["files-api-2025-04-14"],
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "Summarize it."},
        {"type": "document", "source": {"type": "file", "file_id": file.id}},
    ]}],
)
```

`image` blocks take an image, `document` blocks take a PDF (a base64 document) or a text file (a text document). The block keeps its other fields, such as `cache_control`. A wrong kind is a 400.

## Gemini

| Route | What it does |
| --- | --- |
| `POST /upload/v1beta/files` | Upload. The resumable protocol (what `@google/genai` and `google-genai` use) and `uploadType=multipart` (`multipart/related`: JSON metadata, then the file). `uploadType=media` is a 400. |
| `GET /v1beta/files` | `pageSize` (1 to 100, default 10) and `pageToken`. Answers `{files, nextPageToken}`, oldest first. |
| `GET /v1beta/files/{name}` | One File: `name`, `displayName`, `mimeType`, `sizeBytes`, `createTime`, `updateTime`, `expirationTime`, `uri`, `state: "ACTIVE"`, `source: "UPLOADED"`. |
| `DELETE /v1beta/files/{name}` | `{}`. |

A name is `files/` and the 32 hex characters of the file's id (`file-<hex>` on the other APIs). Errors use Google's body: a missing file is a 404 `NOT_FOUND` with the message `File <name> was not found`, on these routes and for a `fileUri` in a request. The key is read as on the other Gemini routes.

The upload URL and the file `uri` name the address the caller reached: the public origin a trusted proxy names (`listen.trustProxy`), else the request's `Host` when the server listens on every address (`0.0.0.0`, `::`), else the listen address.

The resumable upload is held in memory until its last chunk arrives: `start` answers an `X-Goog-Upload-URL`, the chunks go there with `X-Goog-Upload-Command: upload` (the last with `finalize`) and the right `X-Goog-Upload-Offset`, and the finalizing answer carries the file and `X-Goog-Upload-Status: final`. An app holds at most 4 unfinished uploads (a fifth start is a 429), each for 10 minutes. The upload id belongs to its app, and a restart drops unfinished uploads (the caller starts again). The upload URL is the credential of its chunks, as Google's is: `google-genai` (Python) sends the chunks with no key, so a chunk request with no key at all is accepted when it names a live upload id, and it runs as the app that started the upload. An unknown id is a 401, and a request with a key is checked as usual (another app's key gets a 404). An upload stays good only while the key that started it is live: once that key is revoked or rotated out, the upload is gone (a 404 with a key, a 401 without). A chunk with no bytes adds nothing, and expired uploads are dropped by a timer and by any request to the upload route, so their bytes are not held for the next upload to start.

Name a stored file in a request with `fileData`:

```py
file = client.files.upload(file="report.pdf")
client.models.generate_content(model="fast", contents=["Summarize it.", file])
```

`fileUri` is `files/<hex>` or the `uri` an upload returned. The file's type comes from the store, so a `mimeType` in `fileData` is not used. Any other `http(s)` `fileUri` is fetched under the `remoteImages` rules.

## Notes

- **Where it is checked.** Authentication, then the `files` endpoint, then the lookup in the caller's own app. Every Files route is logged under its template (`GET /v1/files/{id}`), never with an id or a file name, and no file content is logged.
- **A download is an attachment.** `GET .../content` answers the stored type with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy, so a browser never renders an uploaded HTML or SVG file.
- **Not supported.** Gemini `uploadType=media`, Gemini `files.registerFiles` (`gs://`), Anthropic `scope_id` and workspace headers, OpenAI `expires_after` and the Batch, fine-tune and Assistants uses of a file, and Gemini file search. Plugboard stores a file to put it in a prompt, nothing else.
- **Not shared between servers.** Files live in one OpenCode server's storage.
