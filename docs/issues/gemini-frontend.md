# Add a Gemini (generateContent) front-end

Some clients only speak Google's Gemini API, with `models/<name>:generateContent` and `:streamGenerateContent`. A third front-end would let them use the providers connected in OpenCode.

## Design notes

Same shape as the other front-ends: parse `contents` (parts with `text`, `inlineData`, `functionCall`, `functionResponse`), `systemInstruction`, `tools.functionDeclarations`, `toolConfig` and `generationConfig` into a `PlugRequest`, and encode events as `GenerateContentResponse` JSON or as the streaming variant.

The model sits in the URL path, so a name containing `/` needs an encoding rule. Probably accept URL-encoded `provider%2Fmodel` and alias names. Gemini sends the key as `x-goog-api-key` or `?key=`. Decide whether to accept the query form at all, since query strings end up in logs.

Gemini function responses carry no call id, so the front-end has to pair them with earlier calls by name and order.

This is the lowest priority of the three extra formats. Do it after `/v1/responses` and `/v1/messages` have proved the front-end seam.

## Acceptance

- The Google GenAI SDK completes a plain chat, a streamed chat and one function-calling round trip.
- Model names with a provider prefix and aliases both resolve.
- The key is accepted from `x-goog-api-key`.
