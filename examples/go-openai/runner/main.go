// Runner for the go-openai example. Started by examples/_harness/run.ts through run.sh, which captures the traffic and
// writes the run. This program marks each scenario on the capture proxy and prints its raw observations; run.sh pipes
// them through examples/_harness/ts/relay.ts, which applies the checks in examples/_shared/scenarios.json. It writes no
// files. The scenarios are the ones in main.go's three calls: S1 text, S2 tool round trip, S3 stream.
//
//	bash run.sh     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

const prompt = "Reply with exactly: pong"

// The scenario ids and models this runner covers, read from the shared list so the models cannot drift.
type scenarioFile struct {
	Scenarios []struct {
		ID     string   `json:"id"`
		Models []string `json:"models"`
	} `json:"scenarios"`
}

func emit(line map[string]any) {
	data, err := json.Marshal(line)
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

// mark tells the capture proxy a scenario starts. The proxy waits there until earlier requests have finished.
func mark(scenario, model string) error {
	url := os.Getenv("PLUGBOARD_CAPTURE_URL")
	if url == "" {
		return errors.New("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
	}
	body, err := json.Marshal(map[string]string{"scenario": scenario, "model": model})
	if err != nil {
		return err
	}
	response, err := http.Post(url+"/__mark", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("capture refused the mark for %s on %s: %d", scenario, model, response.StatusCode)
	}
	return nil
}

// goOpenAIVersion is the go-openai module version the binary was built with, e.g. "1.43.0".
func goOpenAIVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, dep := range info.Deps {
		if dep.Path == "github.com/sashabaranov/go-openai" {
			return strings.TrimPrefix(dep.Version, "v")
		}
	}
	return "unknown"
}

// goMajor is the Go runtime's major version only ("go1.27.2" gives "1"): a scripted run must not depend on the machine's minor.
func goMajor() string {
	return strings.SplitN(strings.TrimPrefix(runtime.Version(), "go"), ".", 2)[0]
}

func s1(ctx context.Context, client *openai.Client, model string) (map[string]any, error) {
	// #region snippet-chat
	response, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:    model,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: prompt}},
	})
	// #endregion snippet-chat
	if err != nil {
		return nil, err
	}
	choice := response.Choices[0]
	var usage any
	if response.Usage.TotalTokens > 0 {
		usage = response.Usage
	}
	return map[string]any{"text": choice.Message.Content, "finish_reason": string(choice.FinishReason), "usage": usage}, nil
}

func s2(ctx context.Context, client *openai.Client, model string) (map[string]any, error) {
	// #region snippet-tool
	tools := []openai.Tool{{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "get_weather",
			Description: "Current weather for a city.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}`),
		},
	}}
	// #endregion snippet-tool
	// #region snippet-tools
	messages := []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "What is the weather in Paris? Use the tool."}}
	first, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{Model: model, Messages: messages, Tools: tools})
	if err != nil {
		return nil, err
	}
	reply := first.Choices[0].Message
	messages = append(messages, reply)
	var call openai.ToolCall
	var args struct {
		City string `json:"city"`
	}
	if len(reply.ToolCalls) > 0 {
		call = reply.ToolCalls[0]
		if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
			return nil, err
		}
		messages = append(messages, openai.ChatCompletionMessage{
			Role:       openai.ChatMessageRoleTool,
			ToolCallID: call.ID,
			Content:    `{"temp_c": 18, "sky": "cloudy", "city": "` + args.City + `"}`,
		})
	}
	final, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{Model: model, Messages: messages, Tools: tools})
	if err != nil {
		return nil, err
	}
	// #endregion snippet-tools
	observed := map[string]any{"finish_reason": string(first.Choices[0].FinishReason)}
	if len(reply.ToolCalls) > 0 {
		observed["tool_name"] = call.Function.Name
		observed["tool_city"] = args.City
		observed["tool_call_id"] = call.ID
	}
	observed["final_text"] = final.Choices[0].Message.Content
	observed["final_finish_reason"] = string(final.Choices[0].FinishReason)
	return observed, nil
}

func s3(ctx context.Context, client *openai.Client, model string) (map[string]any, error) {
	// #region snippet-stream
	stream, err := client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
		Model:         model,
		Messages:      []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: prompt}},
		Stream:        true,
		StreamOptions: &openai.StreamOptions{IncludeUsage: true},
	})
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	var text, finish string
	var usage any
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if chunk.Usage != nil {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			text += choice.Delta.Content
			if choice.FinishReason != "" {
				finish = string(choice.FinishReason)
			}
		}
	}
	// #endregion snippet-stream
	// io.EOF means the stream ended normally, after [DONE].
	return map[string]any{"text": text, "finish_reason": finish, "usage": usage, "done": true}, nil
}

func main() {
	// #region snippet
	cfg := openai.DefaultConfig(os.Getenv("PLUGBOARD_KEY"))
	cfg.BaseURL = os.Getenv("PLUGBOARD_BASE_URL") // already ends in /v1
	client := openai.NewClientWithConfig(cfg)
	// #endregion snippet
	ctx := context.Background()

	emit(map[string]any{"kind": "client", "name": "go-openai", "version": goOpenAIVersion(), "runtime": map[string]string{"name": "go", "version": goMajor()}})

	raw, err := os.ReadFile("../_shared/scenarios.json")
	if err != nil {
		panic(err)
	}
	var file scenarioFile
	if err := json.Unmarshal(raw, &file); err != nil {
		panic(err)
	}
	run := map[string]func(context.Context, *openai.Client, string) (map[string]any, error){"S1": s1, "S2": s2, "S3": s3}
	var planned []string
	for _, scenario := range file.Scenarios {
		if run[scenario.ID] != nil {
			planned = append(planned, scenario.ID)
		}
	}
	emit(map[string]any{"kind": "plan", "scenarios": planned})
	for _, scenario := range file.Scenarios {
		fn := run[scenario.ID]
		if fn == nil {
			continue
		}
		for _, model := range scenario.Models {
			line := map[string]any{"kind": "observation", "scenario": scenario.ID, "model": model}
			if err := mark(scenario.ID, model); err != nil {
				panic(err)
			}
			observations, err := fn(ctx, client, model)
			if err != nil {
				line["error"] = err.Error()
				line["observations"] = map[string]any{}
			} else {
				line["error"] = nil
				line["observations"] = observations
			}
			emit(line)
		}
	}
	emit(map[string]any{"kind": "done"})
}
