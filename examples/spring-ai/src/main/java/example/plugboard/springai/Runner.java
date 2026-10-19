package example.plugboard.springai;

import java.io.IOException;
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
import java.util.function.Function;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Runs S1, S2 and S3 on each model of the shared scenario list and prints one observation line per scenario and model. */
@Component
public class Runner implements CommandLineRunner, ExitCodeGenerator {
  private static final String PROMPT = "Reply with exactly: pong";
  private static final String TOOL_PROMPT = "What is the weather in Paris? Use the tool.";
  private static final String NO_FINISH = "the tool is run inside Spring AI, so the first turn's finish reason is not returned";
  private static final String NO_CALL_ID = "the tool is run inside Spring AI, so the call id is not returned";

  private final JsonMapper json = JsonMapper.builder().build();
  private final HttpClient http = HttpClient.newHttpClient();
  private final ChatClient chat;
  private int exitCode = 0;

  public Runner(ChatClient.Builder builder) {
    this.chat = builder.build();
  }

  @Override
  public int getExitCode() {
    return exitCode;
  }

  /** The tool of S2. Spring AI builds the schema from the method and runs it when the model calls it. */
  static class WeatherTools {
    final List<String> cities = new ArrayList<>();

    // #region snippet-tool
    @Tool(name = "get_weather", description = "Current weather for a city.")
    String getWeather(@ToolParam(description = "The city") String city) {
      cities.add(city);
      return "{\"temp_c\": 18, \"sky\": \"cloudy\", \"city\": \"" + city + "\"}";
    }
    // #endregion snippet-tool
  }

  private static String finish(ChatResponse response) {
    var reason = response.getResult().getMetadata().getFinishReason();
    return reason == null ? null : reason.toLowerCase();
  }

  private static Map<String, Object> usage(Usage usage) {
    if (usage == null || usage.getTotalTokens() == null || usage.getTotalTokens() == 0) return null;
    var out = new LinkedHashMap<String, Object>();
    out.put("input_tokens", usage.getPromptTokens());
    out.put("output_tokens", usage.getCompletionTokens());
    return out;
  }

  private OpenAiChatOptions.Builder model(String model) {
    return OpenAiChatOptions.builder().model(model);
  }

  // S1: one non-streamed call.
  private Map<String, Object> s1(String model) {
    // #region snippet
    ChatResponse response = chat.prompt().user(PROMPT).options(model(model)).call().chatResponse();
    // #endregion snippet
    var out = new LinkedHashMap<String, Object>();
    out.put("text", response.getResult().getOutput().getText());
    out.put("finish_reason", finish(response));
    out.put("usage", usage(response.getMetadata().getUsage()));
    return out;
  }

  // S2: the model calls get_weather, Spring AI runs it and sends the result back, and the model answers.
  private Map<String, Object> s2(String model) {
    var tools = new WeatherTools();
    // #region snippet-tools
    ChatResponse response = chat.prompt().user(TOOL_PROMPT).tools(tools).options(model(model)).call().chatResponse();
    // #endregion snippet-tools
    var out = new LinkedHashMap<String, Object>();
    out.put("tool_name", tools.cities.isEmpty() ? null : "get_weather");
    out.put("tool_city", tools.cities.isEmpty() ? null : tools.cities.get(0));
    out.put("final_text", response.getResult().getOutput().getText());
    out.put("final_finish_reason", finish(response));
    return out;
  }

  // S3: a stream. The text is the deltas joined; the last chunk with a finish reason and the usage chunk are kept.
  private Map<String, Object> s3(String model) {
    // #region snippet-stream
    List<ChatResponse> chunks = chat.prompt().user(PROMPT).options(model(model)).stream().chatResponse().collectList().block();
    // #endregion snippet-stream
    var text = new StringBuilder();
    String finish = null;
    Map<String, Object> usage = null;
    for (ChatResponse chunk : chunks) {
      if (chunk.getResult() != null) {
        var piece = chunk.getResult().getOutput().getText();
        if (piece != null) text.append(piece);
        if (finish(chunk) != null) finish = finish(chunk);
      }
      var seen = usage(chunk.getMetadata().getUsage());
      if (seen != null) usage = seen;
    }
    var out = new LinkedHashMap<String, Object>();
    out.put("text", text.toString());
    out.put("finish_reason", finish);
    out.put("usage", usage);
    out.put("done", true); // collectList() returns only when the stream completed.
    return out;
  }

  private void emit(Map<String, Object> line) {
    System.out.println(json.writeValueAsString(line));
  }

  /** Tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished. */
  private void mark(String scenario, String model) throws IOException, InterruptedException {
    var url = System.getenv("PLUGBOARD_CAPTURE_URL");
    if (url == null) throw new IllegalStateException("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts");
    var body = json.writeValueAsString(Map.of("scenario", scenario, "model", model));
    var request = HttpRequest.newBuilder(URI.create(url + "/__mark")).header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build();
    var response = http.send(request, HttpResponse.BodyHandlers.discarding());
    if (response.statusCode() < 200 || response.statusCode() > 299) {
      throw new IllegalStateException("capture refused the mark for " + scenario + " on " + model + ": " + response.statusCode());
    }
  }

  @Override
  public void run(String... args) throws Exception {
    Map<String, Function<String, Map<String, Object>>> run = new LinkedHashMap<>();
    run.put("S1", this::s1);
    run.put("S2", this::s2);
    run.put("S3", this::s3);

    var version = org.springframework.ai.openai.OpenAiChatModel.class.getPackage().getImplementationVersion();
    var client = new LinkedHashMap<String, Object>();
    client.put("kind", "client");
    client.put("name", "spring-ai");
    client.put("version", version == null ? "unknown" : version);
    client.put("runtime", Map.of("name", "java", "version", String.valueOf(Runtime.version().feature())));
    emit(client);

    var scenarios = json.readTree(Files.readString(Path.of("../_shared/scenarios.json"))).get("scenarios");
    var plan = new LinkedHashMap<String, Object>();
    plan.put("kind", "plan");
    plan.put("scenarios", run.keySet());
    plan.put("unobserved", Map.of(
        "S2", Map.of("turn 1 finish_reason is tool_calls", NO_FINISH, "call id present", NO_CALL_ID)));
    emit(plan);

    for (JsonNode scenario : scenarios) {
      var id = scenario.get("id").asString();
      var fn = run.get(id);
      if (fn == null) continue;
      for (JsonNode modelNode : scenario.get("models")) {
        var model = modelNode.asString();
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
