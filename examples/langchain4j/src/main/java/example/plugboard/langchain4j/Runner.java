// Runner for the LangChain4j example. Started by examples/_harness/run.ts through run.sh, which captures the traffic and
// writes the run. This program marks each scenario on the capture proxy and prints its raw observations; run.sh pipes
// them through examples/_harness/ts/relay.ts, which applies the checks in examples/_shared/scenarios.json. It writes no
// files. The scenarios are the ones below: S1 chat, S2 tool round trip, S3 stream, S4 streaming tool call.
//
//   bash run.sh     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
package example.plugboard.langchain4j;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.request.json.JsonObjectSchema;
import dev.langchain4j.model.chat.response.ChatResponse;
import dev.langchain4j.model.chat.response.StreamingChatResponseHandler;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiStreamingChatModel;
import dev.langchain4j.model.output.FinishReason;
import dev.langchain4j.model.output.TokenUsage;

public class Runner {
  private static final String PROMPT = "Reply with exactly: pong";
  private static final String TOOL_PROMPT = "What is the weather in Paris? Use the tool.";
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final HttpClient HTTP = HttpClient.newHttpClient();
  private static final String BASE_URL = System.getenv("PLUGBOARD_BASE_URL"); // already ends in /v1
  private static final String KEY = System.getenv("PLUGBOARD_KEY");

  // #region snippet-tool
  private static final ToolSpecification WEATHER = ToolSpecification.builder()
      .name("get_weather")
      .description("Current weather for a city.")
      .parameters(JsonObjectSchema.builder().addStringProperty("city").required("city").build())
      .build();
  // #endregion snippet-tool

  // #region snippet-model
  private static ChatModel chatModel(String model) {
    return OpenAiChatModel.builder().baseUrl(BASE_URL).apiKey(KEY).modelName(model).build();
  }

  private static StreamingChatModel streamingModel(String model) {
    return OpenAiStreamingChatModel.builder().baseUrl(BASE_URL).apiKey(KEY).modelName(model).build();
  }
  // #endregion snippet-model

  /** The wire value of a finish reason ("stop", "tool_calls"), not the enum name. */
  private static String finish(FinishReason reason) {
    if (reason == null) return null;
    return switch (reason) {
      case STOP -> "stop";
      case TOOL_EXECUTION -> "tool_calls";
      case LENGTH -> "length";
      case CONTENT_FILTER -> "content_filter";
      default -> reason.name().toLowerCase();
    };
  }

  private static Map<String, Object> usage(TokenUsage usage) {
    if (usage == null || usage.totalTokenCount() == null || usage.totalTokenCount() == 0) return null;
    var out = new LinkedHashMap<String, Object>();
    out.put("input_tokens", usage.inputTokenCount());
    out.put("output_tokens", usage.outputTokenCount());
    return out;
  }

  // S1: one non-streamed call.
  private static Map<String, Object> s1(String model) {
    // #region snippet
    ChatResponse response = chatModel(model).chat(ChatRequest.builder().messages(UserMessage.from(PROMPT)).build());
    // #endregion snippet
    var out = new LinkedHashMap<String, Object>();
    out.put("text", response.aiMessage().text());
    out.put("finish_reason", finish(response.finishReason()));
    out.put("usage", usage(response.tokenUsage()));
    return out;
  }

  // S2: the model calls get_weather, the program sends the result back as a tool result message, and the model answers.
  private static Map<String, Object> s2(String model) {
    var chat = chatModel(model);
    var messages = new ArrayList<ChatMessage>(List.of(UserMessage.from(TOOL_PROMPT)));
    // #region snippet-tools
    ChatResponse first = chat.chat(ChatRequest.builder().messages(messages).toolSpecifications(WEATHER).build());
    AiMessage call = first.aiMessage();
    messages.add(call);
    for (ToolExecutionRequest request : call.toolExecutionRequests()) {
      messages.add(ToolExecutionResultMessage.from(request, "{\"temp_c\": 18, \"sky\": \"cloudy\"}"));
    }
    ChatResponse last = chat.chat(ChatRequest.builder().messages(messages).toolSpecifications(WEATHER).build());
    // #endregion snippet-tools
    var out = new LinkedHashMap<String, Object>();
    out.put("finish_reason", finish(first.finishReason()));
    if (call.hasToolExecutionRequests()) {
      var request = call.toolExecutionRequests().get(0);
      out.put("tool_name", request.name());
      out.put("tool_city", city(request));
      out.put("tool_call_id", request.id());
    }
    out.put("final_text", last.aiMessage().text());
    out.put("final_finish_reason", finish(last.finishReason()));
    return out;
  }

  private static String city(ToolExecutionRequest request) {
    try {
      return JSON.readTree(request.arguments()).path("city").asText(null);
    } catch (Exception error) {
      throw new IllegalStateException("tool arguments are not JSON: " + request.arguments(), error);
    }
  }

  /** One streamed call: the handler collects the partial text and ends with the complete response. */
  private static ChatResponse stream(String model, ChatRequest request, StringBuilder text) {
    var done = new CompletableFuture<ChatResponse>();
    // #region snippet-stream
    streamingModel(model).chat(request, new StreamingChatResponseHandler() {
      @Override
      public void onPartialResponse(String partial) {
        text.append(partial);
      }

      @Override
      public void onCompleteResponse(ChatResponse response) {
        done.complete(response);
      }

      @Override
      public void onError(Throwable error) {
        done.completeExceptionally(error);
      }
    });
    // #endregion snippet-stream
    return done.join();
  }

  // S3: a stream of text.
  private static Map<String, Object> s3(String model) {
    var text = new StringBuilder();
    var response = stream(model, ChatRequest.builder().messages(UserMessage.from(PROMPT)).build(), text);
    var out = new LinkedHashMap<String, Object>();
    out.put("text", text.toString());
    out.put("finish_reason", finish(response.finishReason()));
    out.put("usage", usage(response.tokenUsage()));
    out.put("done", true); // onCompleteResponse ran, which is after the stream's last event.
    return out;
  }

  // S4: a streamed tool call.
  private static Map<String, Object> s4(String model) {
    var response = stream(model, ChatRequest.builder().messages(UserMessage.from(TOOL_PROMPT)).toolSpecifications(WEATHER).build(), new StringBuilder());
    var out = new LinkedHashMap<String, Object>();
    out.put("finish_reason", finish(response.finishReason()));
    if (response.aiMessage().hasToolExecutionRequests()) {
      var request = response.aiMessage().toolExecutionRequests().get(0);
      out.put("tool_name", request.name());
      out.put("tool_city", city(request));
      out.put("tool_call_id", request.id());
    }
    return out;
  }

  private static void emit(Map<String, Object> line) throws Exception {
    System.out.println(JSON.writeValueAsString(line));
  }

  /** Tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished. */
  private static void mark(String scenario, String model) throws Exception {
    var url = System.getenv("PLUGBOARD_CAPTURE_URL");
    if (url == null) throw new IllegalStateException("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts");
    var body = JSON.writeValueAsString(Map.of("scenario", scenario, "model", model));
    var request = HttpRequest.newBuilder(URI.create(url + "/__mark")).header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build();
    var response = HTTP.send(request, HttpResponse.BodyHandlers.discarding());
    if (response.statusCode() < 200 || response.statusCode() > 299) {
      throw new IllegalStateException("capture refused the mark for " + scenario + " on " + model + ": " + response.statusCode());
    }
  }

  public static void main(String[] args) throws Exception {
    Map<String, Function<String, Map<String, Object>>> run = new LinkedHashMap<>();
    run.put("S1", Runner::s1);
    run.put("S2", Runner::s2);
    run.put("S3", Runner::s3);
    run.put("S4", Runner::s4);

    // The version of the langchain4j-open-ai jar, from the pom.properties Maven puts in it.
    var properties = new Properties();
    try (var in = OpenAiChatModel.class.getResourceAsStream("/META-INF/maven/dev.langchain4j/langchain4j-open-ai/pom.properties")) {
      if (in != null) properties.load(in);
    }
    var client = new LinkedHashMap<String, Object>();
    client.put("kind", "client");
    client.put("name", "langchain4j");
    client.put("version", properties.getProperty("version", "unknown"));
    client.put("runtime", Map.of("name", "java", "version", String.valueOf(Runtime.version().feature())));
    emit(client);

    var plan = new LinkedHashMap<String, Object>();
    plan.put("kind", "plan");
    plan.put("scenarios", run.keySet());
    emit(plan);

    JsonNode scenarios = JSON.readTree(Files.readString(Path.of("../_shared/scenarios.json"))).get("scenarios");
    for (JsonNode scenario : scenarios) {
      var id = scenario.get("id").asText();
      var fn = run.get(id);
      if (fn == null) continue;
      for (JsonNode modelNode : scenario.get("models")) {
        var model = modelNode.asText();
        var line = new LinkedHashMap<String, Object>();
        line.put("kind", "observation");
        line.put("scenario", id);
        line.put("model", model);
        mark(id, model);
        try {
          line.put("error", null);
          line.put("observations", fn.apply(model));
        } catch (RuntimeException error) {
          line.put("error", error.getClass().getSimpleName() + ": " + error.getMessage());
          line.put("observations", Map.of());
        }
        emit(line);
      }
    }
    emit(Map.of("kind", "done"));
  }
}
