// Runner for the openai-dotnet example. Started by examples/_harness/run.ts through run.sh, which captures the traffic and
// writes the run. This program marks each scenario on the capture proxy and prints its raw observations; run.sh pipes
// them through examples/_harness/ts/relay.ts, which applies the checks in examples/_shared/scenarios.json. It writes no
// files. The scenarios are the ones in Program.cs: S1 text, S2 tool round trip, S3 stream.
//
//   bash run.sh     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness

using System.ClientModel;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using OpenAI;
using OpenAI.Chat;

const string Prompt = "Reply with exactly: pong";
const string ToolPrompt = "What is the weather in Paris? Use the tool.";

string baseUrl = Environment.GetEnvironmentVariable("PLUGBOARD_BASE_URL") ?? throw new InvalidOperationException("PLUGBOARD_BASE_URL is not set.");
string key = Environment.GetEnvironmentVariable("PLUGBOARD_KEY") ?? throw new InvalidOperationException("PLUGBOARD_KEY is not set.");
string captureUrl = Environment.GetEnvironmentVariable("PLUGBOARD_CAPTURE_URL") ?? throw new InvalidOperationException("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts.");

var options = new OpenAIClientOptions { Endpoint = new Uri(baseUrl) }; // already ends in /v1
var http = new HttpClient();

ChatClient ClientFor(string model) => new(model: model, credential: new ApiKeyCredential(key), options: options);

void Emit(object line) => Console.WriteLine(JsonSerializer.Serialize(line));

// Tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished.
async Task MarkAsync(string scenario, string model)
{
    var body = new StringContent(JsonSerializer.Serialize(new { scenario, model }), Encoding.UTF8, "application/json");
    using var response = await http.PostAsync($"{captureUrl}/__mark", body);
    if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"capture refused the mark for {scenario} on {model}: {(int)response.StatusCode}");
}

// The wire value of a finish reason ("stop", "tool_calls"), not the enum name the SDK's ToString gives ("Stop").
string FinishName(ChatFinishReason reason) => reason switch
{
    ChatFinishReason.Stop => "stop",
    ChatFinishReason.ToolCalls => "tool_calls",
    ChatFinishReason.Length => "length",
    ChatFinishReason.ContentFilter => "content_filter",
    _ => reason.ToString(),
};

Dictionary<string, object?> Usage(ChatTokenUsage usage) => new() { ["input_tokens"] = usage.InputTokenCount, ["output_tokens"] = usage.OutputTokenCount };

// S1: one non-streamed call.
Dictionary<string, object?> S1(string model)
{
    ChatCompletion completion = ClientFor(model).CompleteChat([new UserChatMessage(Prompt)]);
    return new()
    {
        ["text"] = completion.Content[0].Text,
        ["finish_reason"] = FinishName(completion.FinishReason),
        ["usage"] = completion.Usage is null ? null : Usage(completion.Usage),
    };
}

// S2: a get_weather call, the assistant turn sent back, then the tool result under the same call id.
Dictionary<string, object?> S2(string model)
{
    ChatTool weatherTool = ChatTool.CreateFunctionTool(
        functionName: "get_weather",
        functionDescription: "Current weather for a city.",
        functionParameters: BinaryData.FromString("""
            {
                "type": "object",
                "properties": { "city": { "type": "string" } },
                "required": [ "city" ]
            }
            """));
    var toolOptions = new ChatCompletionOptions();
    toolOptions.Tools.Add(weatherTool);
    ChatClient client = ClientFor(model);

    var observed = new Dictionary<string, object?>();
    List<ChatMessage> messages = [new UserChatMessage(ToolPrompt)];
    ChatCompletion first = client.CompleteChat(messages, toolOptions);
    observed["finish_reason"] = FinishName(first.FinishReason);
    messages.Add(new AssistantChatMessage(first));
    if (first.ToolCalls.Count > 0)
    {
        ChatToolCall call = first.ToolCalls[0];
        using var argsJson = JsonDocument.Parse(call.FunctionArguments);
        string city = argsJson.RootElement.GetProperty("city").GetString() ?? "";
        observed["tool_name"] = call.FunctionName;
        observed["tool_city"] = city;
        observed["tool_call_id"] = call.Id;
        messages.Add(new ToolChatMessage(call.Id, $$"""{"temp_c": 18, "sky": "cloudy", "city": "{{city}}"}"""));
    }
    ChatCompletion final = client.CompleteChat(messages, toolOptions);
    observed["final_text"] = final.Content[0].Text;
    observed["final_finish_reason"] = FinishName(final.FinishReason);
    return observed;
}

// S3: a streamed call with usage requested. The stream ends normally after [DONE].
Dictionary<string, object?> S3(string model)
{
    var text = new StringBuilder();
    string? finish = null;
    ChatTokenUsage? usage = null;
    foreach (StreamingChatCompletionUpdate update in ClientFor(model).CompleteChatStreaming([new UserChatMessage(Prompt)]))
    {
        foreach (ChatMessageContentPart part in update.ContentUpdate) text.Append(part.Text);
        if (update.FinishReason is not null) finish = FinishName(update.FinishReason.Value);
        if (update.Usage is not null) usage = update.Usage;
    }
    return new() { ["text"] = text.ToString(), ["finish_reason"] = finish, ["usage"] = usage is null ? null : Usage(usage), ["done"] = true };
}

// The OpenAI package version, from its informational version (e.g. "2.14.0+<commit>" gives "2.14.0").
string ClientVersion()
{
    string? informational = typeof(ChatClient).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
    return informational?.Split('+')[0] ?? "unknown";
}

Emit(new { kind = "client", name = "openai-dotnet", version = ClientVersion(), runtime = new { name = "dotnet", version = Environment.Version.Major.ToString() } });

// The scenario ids and models this runner covers, read from the shared list so the models cannot drift.
using var scenarioFile = JsonDocument.Parse(await File.ReadAllTextAsync("../_shared/scenarios.json"));
var run = new Dictionary<string, Func<string, Dictionary<string, object?>>> { ["S1"] = S1, ["S2"] = S2, ["S3"] = S3 };
var scenarios = scenarioFile.RootElement.GetProperty("scenarios").EnumerateArray()
    .Where(scenario => run.ContainsKey(scenario.GetProperty("id").GetString() ?? ""))
    .ToList();
Emit(new { kind = "plan", scenarios = scenarios.Select(scenario => scenario.GetProperty("id").GetString()).ToArray() });

foreach (JsonElement scenario in scenarios)
{
    string id = scenario.GetProperty("id").GetString()!;
    foreach (JsonElement modelElement in scenario.GetProperty("models").EnumerateArray())
    {
        string model = modelElement.GetString()!;
        await MarkAsync(id, model);
        try
        {
            Dictionary<string, object?> observations = run[id](model);
            Emit(new { kind = "observation", scenario = id, model, error = (string?)null, observations });
        }
        catch (Exception caught)
        {
            Emit(new { kind = "observation", scenario = id, model, error = $"{caught.GetType().Name}: {caught.Message}", observations = new Dictionary<string, object?>() });
        }
    }
}
Emit(new { kind = "done" });
