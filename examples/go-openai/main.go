// A one-tool chat on plugboard with go-openai (#234).
//
//	PLUGBOARD_KEY=<app key> go run .
//	PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> go run .   # default URL shown
//
// It runs three calls: a text reply, a streamed reply, and one tool round trip.
// Plugboard serves /v1/chat/completions, which this program uses.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

const model = "fast" // alias from the plugboard `aliases` option

func getWeather(city string) string {
	return `{"temp_c": 18, "sky": "cloudy", "city": "` + city + `"}`
}

func main() {
	base := strings.TrimRight(getenv("PLUGBOARD_URL", "http://127.0.0.1:4010"), "/")
	cfg := openai.DefaultConfig(os.Getenv("PLUGBOARD_KEY"))
	cfg.BaseURL = base + "/v1" // BaseURL replaces the default whole, so keep /v1
	client := openai.NewClientWithConfig(cfg)
	ctx := context.Background()

	// 1. Text.
	text, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:               model,
		MaxCompletionTokens: 1024, // room for reasoning models to answer
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleUser, Content: "Reply with exactly: pong"},
		},
	})
	must(err)
	fmt.Println("text:", text.Choices[0].Message.Content)

	// 2. Stream.
	stream, err := client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
		Model:               model,
		MaxCompletionTokens: 1024,
		Stream:              true,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleUser, Content: "Count from 1 to 3."},
		},
	})
	must(err)
	fmt.Print("stream: ")
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		must(err)
		if len(chunk.Choices) > 0 {
			fmt.Print(chunk.Choices[0].Delta.Content)
		}
	}
	stream.Close()
	fmt.Println()

	// 3. One tool call and its result.
	tools := []openai.Tool{{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "get_weather",
			Description: "Current weather for a city.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}`),
		},
	}}
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "What is the weather in Paris? Use the tool."},
	}
	first, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: model, MaxCompletionTokens: 1024, Messages: messages, Tools: tools,
	})
	must(err)
	reply := first.Choices[0].Message
	messages = append(messages, reply)
	for _, call := range reply.ToolCalls {
		var args struct {
			City string `json:"city"`
		}
		must(json.Unmarshal([]byte(call.Function.Arguments), &args))
		messages = append(messages, openai.ChatCompletionMessage{
			Role:       openai.ChatMessageRoleTool,
			ToolCallID: call.ID,
			Content:    getWeather(args.City),
		})
	}
	final, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: model, MaxCompletionTokens: 1024, Messages: messages, Tools: tools,
	})
	must(err)
	fmt.Println("tool:", final.Choices[0].Message.Content)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
