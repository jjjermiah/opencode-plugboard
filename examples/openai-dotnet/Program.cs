// A one-tool chat on plugboard with the official OpenAI .NET library (#236).
//
//   PLUGBOARD_KEY=<app key> dotnet run
//   PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> dotnet run   # default URL
//
// It runs three calls: a text reply, a streamed reply, and one tool round trip.
// Plugboard serves /v1/chat/completions, which this program uses.

using System.ClientModel;
using OpenAI;
using OpenAI.Chat;

string baseUrl = (Environment.GetEnvironmentVariable("PLUGBOARD_URL") ?? "http://127.0.0.1:4010").TrimEnd('/');
string key = Environment.GetEnvironmentVariable("PLUGBOARD_KEY") ?? throw new InvalidOperationException("Set PLUGBOARD_KEY.");

// Endpoint replaces the base URL whole, so include /v1.
var options = new OpenAIClientOptions { Endpoint = new Uri($"{baseUrl}/v1") };
ChatClient client = new(model: "fast", credential: new ApiKeyCredential(key), options: options);

// 1. Text. `fast` is an alias from the plugboard `aliases` option.
ChatCompletion text = client.CompleteChat(
    [new UserChatMessage("Reply with exactly: pong")],
    new ChatCompletionOptions { MaxOutputTokenCount = 1024 }); // room for reasoning models to answer
Console.WriteLine($"text: {text.Content[0].Text}");

// 2. Stream.
Console.Write("stream: ");
foreach (StreamingChatCompletionUpdate update in client.CompleteChatStreaming(
    [new UserChatMessage("Count from 1 to 3.")],
    new ChatCompletionOptions { MaxOutputTokenCount = 1024 }))
{
    foreach (ChatMessageContentPart part in update.ContentUpdate)
    {
        Console.Write(part.Text);
    }
}
Console.WriteLine();

// 3. One tool call and its result.
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

var toolOptions = new ChatCompletionOptions { MaxOutputTokenCount = 1024 };
toolOptions.Tools.Add(weatherTool);

List<ChatMessage> messages = [new UserChatMessage("What is the weather in Paris? Use the tool.")];
ChatCompletion first = client.CompleteChat(messages, toolOptions);
messages.Add(new AssistantChatMessage(first));

foreach (ChatToolCall call in first.ToolCalls)
{
    using var argsJson = System.Text.Json.JsonDocument.Parse(call.FunctionArguments);
    string city = argsJson.RootElement.GetProperty("city").GetString() ?? "";
    messages.Add(new ToolChatMessage(call.Id, $$"""{"temp_c": 18, "sky": "cloudy", "city": "{{city}}"}"""));
}

ChatCompletion final = client.CompleteChat(messages, toolOptions);
Console.WriteLine($"tool: {final.Content[0].Text}");
